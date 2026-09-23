import { randomUUID } from 'node:crypto';
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from '@hocuspocus/provider';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { collabAuthError, safeCollabCode } from './errors.js';
import {
  buildCollabDocumentName,
  normalizeCollabFilePath,
} from './roomName.js';
import { collabTimeout } from './session.js';
import { collabHash, readText, replaceText } from './text.js';
import {
  CollabError,
  type CollabOpenOptions,
  CollabPublishError,
  type CollabPublishResult,
  type CollabReadResult,
  CollabUnknownError,
  type CollabWriteResult,
} from './types.js';

type PublishAck = {
  type?: string;
  reqId?: string;
  ref?: string;
  content_ref?: string;
  external_backup?: string;
  code?: string;
  outcome?: string;
  identity?: unknown;
};

type PendingPublish = {
  resolve: (value: CollabPublishResult) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type OpenedCollabOptions = CollabOpenOptions & {
  timeoutMs: number;
};

function wsUrl(baseUrl: string): string {
  const u = new URL(baseUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/collab';
  u.search = '';
  u.hash = '';
  return u.toString();
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new CollabError(
            'connection_timeout',
            `${label} timed out after ${ms}ms; no edit sent`
          )
        ),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export class CollabRoomClient {
  readonly doc = new Y.Doc();
  private provider: HocuspocusProvider | null = null;
  private websocketProvider: HocuspocusProviderWebsocket | null = null;
  private openOptions: OpenedCollabOptions | null = null;
  private pending = new Map<string, PendingPublish>();
  private connected = false;
  private synced = false;
  private readOnly = false;
  private closed = false;
  private terminalError: Error | null = null;
  private rejectOpen: ((err: Error) => void) | null = null;
  private mutationSent = false;

  async open(options: CollabOpenOptions): Promise<CollabReadResult> {
    if (this.openOptions || this.closed)
      throw new CollabError(
        'room_closed',
        'use a new collab client to open a room'
      );
    const openOptions = {
      ...options,
      // Session paths are canonical, not URL-encoded. Do not decode % twice.
      path: options.fileId
        ? options.path
        : normalizeCollabFilePath(options.path),
      timeoutMs: collabTimeout(options.timeoutMs),
    };
    this.openOptions = openOptions;
    this.readOnly = options.readOnly ?? false;

    const opened = new Promise<void>((resolve, reject) => {
      this.rejectOpen = reject;
      const websocketProvider = new HocuspocusProviderWebsocket({
        url: wsUrl(openOptions.baseUrl),
        WebSocketPolyfill: WebSocket,
        parameters: {
          space_id: openOptions.spaceId,
          file_path: openOptions.path,
          ...(openOptions.fileId ? { file_id: openOptions.fileId } : {}),
          client: openOptions.client,
          client_version: openOptions.clientVersion,
        },
      });
      this.websocketProvider = websocketProvider;
      const provider = new HocuspocusProvider({
        websocketProvider,
        name: buildCollabDocumentName(
          openOptions.spaceId,
          openOptions.path,
          openOptions.fileId
        ),
        document: this.doc,
        token: () => openOptions.token,
        onAuthenticated: () => {
          this.readOnly =
            this.readOnly || this.provider?.authorizedScope === 'readonly';
        },
        onAuthenticationFailed: (data) => {
          this.fail(collabAuthError(data.reason));
        },
        onStatus: ({ status }) => {
          this.connected = status === 'connected';
        },
        onSynced: ({ state }) => {
          this.synced = state;
          if (state && !this.terminalError) resolve();
        },
        onStateless: ({ payload }) => {
          this.handleStateless(payload);
        },
        onDisconnect: () => {
          this.fail(
            new CollabError(
              'service_unavailable',
              'collab connection lost; reopen and re-read'
            )
          );
        },
        onClose: () => {
          this.fail(
            new CollabError(
              'service_unavailable',
              'collab connection closed; reopen and re-read'
            )
          );
        },
      });
      this.provider = provider;
    });

    try {
      await withTimeout(opened, openOptions.timeoutMs, 'collab open');
      this.rejectOpen = null;
      return this.read();
    } catch (err) {
      this.close();
      throw err;
    }
  }

  read(): CollabReadResult {
    if (!this.openOptions) throw new Error('collab room is not open');
    const content = readText(this.doc);
    return {
      spaceId: this.openOptions.spaceId,
      path: this.openOptions.path,
      content,
      collabHash: collabHash(content),
      connected:
        this.connected && this.synced && !this.closed && !this.terminalError,
      readOnly: this.readOnly,
    };
  }

  write(
    content: string,
    opts: { baseHash?: string; force?: boolean } = {}
  ): CollabWriteResult {
    this.assertWritable();
    if (!this.openOptions) throw new Error('collab room is not open');
    const result = replaceText(this.doc, content, {
      baseHash: opts.baseHash,
      force: opts.force,
      origin: this.openOptions.client,
    });
    this.mutationSent = true;
    return {
      spaceId: this.openOptions.spaceId,
      path: this.openOptions.path,
      previousHash: result.previousHash,
      collabHash: result.hash,
    };
  }

  async publish(timeoutMs?: number): Promise<CollabPublishResult> {
    this.assertWritable();
    if (!this.provider || !this.openOptions)
      throw new Error('collab room is not open');
    const reqId = randomUUID();
    const ms = collabTimeout(timeoutMs ?? this.openOptions.timeoutMs);

    const result = new Promise<CollabPublishResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        const error = new CollabUnknownError(
          `collab publish ack timed out after ${ms}ms`
        );
        reject(error);
        this.fail(error);
      }, ms);
      this.pending.set(reqId, { resolve, reject, timer });
    });

    try {
      this.provider.sendStateless(
        JSON.stringify({
          type: 'publish',
          reqId,
          operationId: reqId,
          client: this.openOptions.client,
          client_version: this.openOptions.clientVersion,
        })
      );
    } catch {
      this.fail(new CollabUnknownError('collab publish transport unconfirmed'));
    }
    return result;
  }

  async confirmChanges(): Promise<void> {
    if (this.terminalError || !this.connected)
      throw new CollabUnknownError('collab update confirmation lost');
    const provider = this.provider;
    if (!provider || !this.openOptions)
      throw new CollabError('room_closed', 'collab room is closed');
    if (!provider.hasUnsyncedChanges) return;
    await new Promise<void>((resolve, reject) => {
      const finish = (err?: Error) => {
        clearTimeout(timer);
        provider.off('unsyncedChanges', onChange);
        provider.off('close', onClose);
        if (err) reject(err);
        else resolve();
      };
      const onChange = () => {
        if (!provider.hasUnsyncedChanges) finish();
      };
      const onClose = () =>
        finish(new CollabUnknownError('collab update confirmation lost'));
      const timer = setTimeout(
        () =>
          finish(
            new CollabUnknownError('collab update confirmation timed out')
          ),
        this.openOptions?.timeoutMs
      );
      provider.on('unsyncedChanges', onChange);
      provider.on('close', onClose);
      onChange();
    });
  }

  private assertWritable(): void {
    if (this.terminalError || this.closed || !this.connected || !this.synced) {
      if (this.mutationSent)
        throw new CollabUnknownError(
          'collab connection lost after edit; saved state unconfirmed'
        );
      throw (
        this.terminalError ??
        new CollabError(
          'room_closed',
          'collab room is not connected and synced'
        )
      );
    }
    if (this.readOnly)
      throw new CollabError('read_only', 'collab room is read-only');
  }

  private fail(error: Error): void {
    if (this.closed || this.terminalError) return;
    this.terminalError =
      this.pending.size > 0
        ? new CollabUnknownError(
            'collab connection lost before publish confirmation'
          )
        : error;
    this.connected = false;
    this.synced = false;
    this.rejectOpen?.(error);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(
        new CollabUnknownError(
          'collab connection lost before publish confirmation'
        )
      );
    }
    this.pending.clear();
    // Never reconnect and replay queued publishes or edits after an uncertain
    // transport failure. A caller must explicitly reopen and read first.
    this.websocketProvider?.disconnect();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    this.synced = false;
    this.rejectOpen?.(
      new CollabError('room_closed', 'collab room closed during open')
    );
    this.rejectOpen = null;
    for (const [reqId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(
        new CollabUnknownError('collab room closed before publish ack')
      );
      this.pending.delete(reqId);
    }
    // Hocuspocus 2 removes its ws error listener during destroy. Node ws emits
    // an asynchronous error when a CONNECTING socket is closed; keep a local
    // sink for that expected cancellation, without logging transport details.
    this.websocketProvider?.webSocket?.addEventListener('error', () => {});
    this.provider?.destroy();
    this.websocketProvider?.destroy();
    this.provider = null;
    this.websocketProvider = null;
    this.doc.destroy();
  }

  private handleStateless(payload: string): void {
    let msg: PublishAck;
    try {
      msg = JSON.parse(payload) as PublishAck;
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'file_identity') {
      this.updateIdentity(msg);
      return;
    }
    if (msg.type === 'external_deleted') {
      this.fail(
        new CollabError(
          'external_deleted',
          'collab document deleted; automatic recreation is disabled'
        )
      );
      return;
    }
    if (!msg.reqId) return;
    if (msg.type !== 'publish_ack' && msg.type !== 'publish_error') return;
    const pending = this.pending.get(msg.reqId);
    if (!pending) return;
    this.pending.delete(msg.reqId);
    clearTimeout(pending.timer);

    if (msg.type === 'publish_ack') {
      if (
        !this.openOptions ||
        typeof msg.ref !== 'string' ||
        !msg.ref ||
        (msg.outcome !== undefined && msg.outcome !== 'success')
      ) {
        const error = new CollabUnknownError(
          'collab publish acknowledgement invalid'
        );
        pending.reject(error);
        this.fail(error);
        return;
      }
      if (msg.identity) this.updateIdentity(msg.identity);
      if (this.terminalError) {
        pending.reject(
          new CollabUnknownError('collab publish identity unconfirmed')
        );
        return;
      }
      pending.resolve({
        spaceId: this.openOptions.spaceId,
        path: this.openOptions.path,
        ref: msg.ref || '',
        contentRef: msg.content_ref || '',
        externalBackup: msg.external_backup || '',
      });
      return;
    }

    const code = safeCollabCode(msg.code);
    // Older servers omitted outcome even after a network/flush failure.
    const knownRejection = [
      'forbidden',
      'read_only',
      'external_deleted',
      'content_too_large',
    ].includes(code ?? '');
    if (
      msg.outcome === 'unknown' ||
      (msg.outcome !== 'failure' && !knownRejection) ||
      /^(?:identity_)?http_5\d\d$/.test(code ?? '')
    ) {
      const error = new CollabUnknownError(
        `collab publish unconfirmed${code ? `: ${code}` : ''}`,
        code
      );
      pending.reject(error);
      this.fail(error);
      return;
    }
    pending.reject(
      new CollabPublishError(
        `collab publish failed${code ? `: ${code}` : '; reason unavailable'}`,
        code ?? 'publish_rejected'
      )
    );
  }

  private updateIdentity(value: unknown): void {
    if (!value || typeof value !== 'object' || !this.openOptions?.fileId)
      return;
    const id = value as Record<string, unknown>;
    if (
      id.file_id !== this.openOptions.fileId ||
      id.space_id !== this.openOptions.spaceId
    ) {
      this.fail(
        new CollabError(
          'identity_conflict',
          'collab room identity mismatch; reopen and re-read'
        )
      );
      return;
    }
    if (
      Number.isSafeInteger(id.identity_version) &&
      (id.identity_version as number) >=
        (this.openOptions.identityVersion ?? 0) &&
      typeof id.file_path === 'string' &&
      id.file_path
    ) {
      this.openOptions.path = id.file_path;
      this.openOptions.identityVersion = id.identity_version as number;
    }
  }
}

export async function withCollabRoom<T>(
  options: CollabOpenOptions,
  fn: (room: CollabRoomClient) => Promise<T>
): Promise<T> {
  const room = new CollabRoomClient();
  try {
    await room.open(options);
    return await fn(room);
  } finally {
    room.close();
  }
}
