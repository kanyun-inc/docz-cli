import { randomUUID } from 'node:crypto';
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from '@hocuspocus/provider';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { buildCollabDocumentName, normalizeCollabFilePath } from './roomName.js';
import { collabHash, readText, replaceText } from './text.js';
import {
  CollabPublishError,
  CollabUnknownError,
  type CollabOpenOptions,
  type CollabPublishResult,
  type CollabReadResult,
  type CollabWriteResult,
} from './types.js';

type PublishAck = {
  type?: string;
  reqId?: string;
  ref?: string;
  content_ref?: string;
  external_backup?: string;
  code?: string;
};

type PendingPublish = {
  resolve: (value: CollabPublishResult) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

function wsUrl(baseUrl: string): string {
  const u = new URL(baseUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/collab';
  u.search = '';
  u.hash = '';
  return u.toString();
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new CollabUnknownError(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export class CollabRoomClient {
  readonly doc = new Y.Doc();
  private provider: HocuspocusProvider | null = null;
  private websocketProvider: HocuspocusProviderWebsocket | null = null;
  private openOptions: CollabOpenOptions | null = null;
  private pending = new Map<string, PendingPublish>();
  private connected = false;
  private synced = false;
  private readOnly = false;

  async open(options: CollabOpenOptions): Promise<CollabReadResult> {
    this.openOptions = {
      ...options,
      path: normalizeCollabFilePath(options.path),
      timeoutMs: options.timeoutMs ?? 30000,
    };

    const opened = new Promise<void>((resolve, reject) => {
      const websocketProvider = new HocuspocusProviderWebsocket({
        url: wsUrl(this.openOptions!.baseUrl),
        WebSocketPolyfill: WebSocket,
        parameters: {
          space_id: this.openOptions!.spaceId,
          file_path: this.openOptions!.path,
          client: this.openOptions!.client,
          client_version: this.openOptions!.clientVersion,
        },
      });
      this.websocketProvider = websocketProvider;
      const provider = new HocuspocusProvider({
        websocketProvider,
        name: buildCollabDocumentName(this.openOptions!.spaceId, this.openOptions!.path),
        document: this.doc,
        token: () => this.openOptions!.token,
        onAuthenticated: () => {},
        onAuthenticationFailed: (data) => {
          reject(new CollabPublishError(`collab authentication failed: ${data.reason}`, 'auth_failed'));
        },
        onStatus: ({ status }) => {
          this.connected = status === 'connected';
        },
        onSynced: ({ state }) => {
          this.synced = state;
          if (state) resolve();
        },
        onStateless: ({ payload }) => {
          this.handleStateless(payload);
        },
        onDisconnect: () => {
          this.connected = false;
        },
      });
      this.provider = provider;
    });

    await withTimeout(opened, this.openOptions.timeoutMs!, 'collab open');
    return this.read();
  }

  read(): CollabReadResult {
    if (!this.openOptions) throw new Error('collab room is not open');
    const content = readText(this.doc);
    return {
      spaceId: this.openOptions.spaceId,
      path: this.openOptions.path,
      content,
      collabHash: collabHash(content),
      connected: this.connected && this.synced,
      readOnly: this.readOnly,
    };
  }

  write(content: string, opts: { baseHash?: string; force?: boolean } = {}): CollabWriteResult {
    if (!this.openOptions) throw new Error('collab room is not open');
    if (this.readOnly) throw new CollabPublishError('collab room is read-only', 'read_only');
    const result = replaceText(this.doc, content, {
      baseHash: opts.baseHash,
      force: opts.force,
      origin: this.openOptions.client,
    });
    return {
      spaceId: this.openOptions.spaceId,
      path: this.openOptions.path,
      previousHash: result.previousHash,
      collabHash: result.hash,
    };
  }

  async publish(timeoutMs?: number): Promise<CollabPublishResult> {
    if (!this.provider || !this.openOptions) throw new Error('collab room is not open');
    const reqId = randomUUID();
    const ms = timeoutMs ?? this.openOptions.timeoutMs ?? 30000;

    const result = new Promise<CollabPublishResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new CollabUnknownError(`collab publish ack timed out after ${ms}ms`));
      }, ms);
      this.pending.set(reqId, { resolve, reject, timer });
    });

    this.provider.sendStateless(
      JSON.stringify({
        type: 'publish',
        reqId,
        client: this.openOptions.client,
        client_version: this.openOptions.clientVersion,
      })
    );
    return result;
  }

  close(): void {
    for (const [reqId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new CollabUnknownError('collab room closed before publish ack'));
      this.pending.delete(reqId);
    }
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
    if (!msg.reqId) return;
    const pending = this.pending.get(msg.reqId);
    if (!pending) return;
    this.pending.delete(msg.reqId);
    clearTimeout(pending.timer);

    if (msg.type === 'publish_ack' || msg.type === 'recreate_after_delete_ack') {
      pending.resolve({
        spaceId: this.openOptions!.spaceId,
        path: this.openOptions!.path,
        ref: msg.ref || '',
        contentRef: msg.content_ref || '',
        externalBackup: msg.external_backup || '',
      });
      return;
    }

    pending.reject(new CollabPublishError(`collab publish failed${msg.code ? `: ${msg.code}` : ''}`, msg.code));
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
