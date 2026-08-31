import '@univerjs/sheets/facade';
import '@univerjs-pro/collaboration-client/facade';

import {
  covertCellValues,
  DependentOn,
  Disposable,
  IAuthzIoService,
  ICommandService,
  ILogService,
  IMentionIOService,
  Injector,
  IUndoRedoService,
  LocaleType,
  LogLevel,
  Plugin,
  registerDependencies,
  setDependencies,
  Univer,
} from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import {
  type ISocket,
  ISocketService,
  type ISocketService as ISocketServiceContract,
  UniverNetworkPlugin,
} from '@univerjs/network';
import { SetRangeValuesCommand, UniverSheetsPlugin } from '@univerjs/sheets';
import sheetsEnUS from '@univerjs/sheets/locale/en-US';
import {
  RevisionService,
  UniverCollaborationPlugin,
} from '@univerjs-pro/collaboration';
import {
  CollaborationSessionService,
  CollaborationStatus,
  UniverCollaborationClientPlugin,
} from '@univerjs-pro/collaboration-client';
import collaborationEnUS from '@univerjs-pro/collaboration-client/locale/en-US';
import { NodeCollaborationSocketService } from '@univerjs-pro/collaboration-client-node';
import { UniverLicensePlugin } from '@univerjs-pro/license';
import { Observable, share } from 'rxjs';
import { WebSocket } from 'ws';
import type { OpenSheetOptions, OpenUniverSheet } from './types.js';

// Univer may serialize transport internals (including request headers) when it
// logs collaboration failures. The CLI already reports bounded failure codes,
// so vendor logging must stay disabled to avoid credential disclosure.
export const SHEET_UNIVER_LOG_LEVEL = LogLevel.SILENT;

// Univer 0.21.1 checks `if (logLevel)` during construction. SILENT is numeric
// zero, so the config value is accidentally ignored and the service stays at
// INFO. Apply it explicitly through the public log-service contract while the
// dependency remains pinned to this vendor version.
export function forceUniverSilentLogging(univer: Univer): void {
  univer.__getInjector().get(ILogService).setLogLevel(SHEET_UNIVER_LOG_LEVEL);
}

export function validateUniverEndpoint(raw: string, doczBaseUrl: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(raw);
  } catch {
    throw new Error('Server returned an invalid absolute Univer endpoint.');
  }
  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password
  ) {
    throw new Error('Server returned an unsafe Univer endpoint.');
  }
  let doczOrigin: string;
  try {
    doczOrigin = new URL(doczBaseUrl).origin;
  } catch {
    throw new Error('Configured Docz base URL is invalid.');
  }
  if (endpoint.origin !== doczOrigin) {
    throw new Error('Server returned a cross-origin Univer endpoint.');
  }
  endpoint.search = '';
  endpoint.hash = '';
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, '');
  return endpoint;
}

function endpointPath(endpoint: URL, path: string): string {
  return `${endpoint.toString().replace(/\/$/, '')}${path}`;
}

function websocketPath(endpoint: URL, path: string): string {
  const ws = new URL(endpointPath(endpoint, path));
  ws.protocol = ws.protocol === 'https:' ? 'wss:' : 'ws:';
  return ws.toString();
}

// ws ErrorEvent.target retains the entire ClientRequest, including raw
// Authorization headers. Univer logs the event object on reconnect failures
// even at SILENT level, so never expose the transport event to vendor code.
// Collaboration only needs an error signal; a bounded browser-like event is
// sufficient and preserves the reconnect/offline state machine.
export function sheetSocketEventForVendor(
  eventName: 'open' | 'close' | 'error' | 'message',
  event: unknown
): unknown {
  if (eventName !== 'error') return event;
  return {
    type: 'error',
    message: 'Docz Sheet WebSocket transport error.',
  };
}

function createSheetNodeSocketService(headers: Record<string, string>) {
  return class SheetNodeSocketService
    extends Disposable
    implements ISocketServiceContract
  {
    private readonly sockets = new Set<WebSocket>();

    createSocket(url: string): ISocket {
      const socket = new WebSocket(url, { headers });
      this.sockets.add(socket);
      // A CONNECTING socket emits error when it is terminated. Keep one
      // permanent no-op listener in addition to the observable below so SDK
      // teardown order can never turn expected cleanup into an uncaught error.
      const absorbCleanupError = () => {};
      socket.on('error', absorbCleanupError);
      socket.once('close', () => {
        this.sockets.delete(socket);
        socket.off('error', absorbCleanupError);
      });

      const observe = (eventName: 'open' | 'close' | 'error' | 'message') =>
        new Observable<never>((subscriber) => {
          const listener = (event: unknown) =>
            subscriber.next(
              sheetSocketEventForVendor(eventName, event) as never
            );
          // Univer's collaboration layer consumes browser-compatible event
          // objects (`message.data`). ws exposes those through EventTarget;
          // EventEmitter's `message` callback would pass only the raw payload.
          socket.addEventListener(eventName, listener as never);
          return () => socket.removeEventListener(eventName, listener as never);
        }).pipe(share());

      return {
        URL: url,
        close: (code?: number, reason?: string) => {
          if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
          else if (socket.readyState === WebSocket.OPEN)
            socket.close(code, reason);
        },
        send: (data) => socket.send(data),
        open$: observe('open'),
        close$: observe('close'),
        error$: observe('error'),
        message$: observe('message'),
      };
    }

    override dispose(): void {
      for (const socket of this.sockets) socket.terminate();
      this.sockets.clear();
      super.dispose();
    }
  };
}

function createSheetNodeSocketPlugin(headers: Record<string, string>) {
  const SheetNodeSocketService = createSheetNodeSocketService(headers);
  class SheetNodeSocketPlugin extends Plugin {
    static override pluginName = 'DOCZ_SHEET_NODE_SOCKET_PLUGIN';

    constructor(
      _config: Record<string, never> | undefined,
      protected override readonly _injector: Injector
    ) {
      super();
    }

    override onStarting(): void {
      registerDependencies(this._injector, [
        [ISocketService, { useClass: SheetNodeSocketService }],
      ]);
    }
  }
  // Plugin configuration is constructor argument zero; the injector supplies
  // the remaining argument. This is the non-decorator form supported by Redi.
  setDependencies(SheetNodeSocketPlugin, [Injector], 1);
  DependentOn(UniverCollaborationClientPlugin)(SheetNodeSocketPlugin);
  return SheetNodeSocketPlugin;
}

// Univer 0.21.1 leaves a not-yet-open candidate socket alive when a session is
// disposed while connecting. Close this narrow compatibility seam explicitly
// so a failed CLI command cannot keep the Node.js process alive indefinitely.
export function closePendingCollaborationSocket(service: unknown): void {
  const candidate = (
    service as
      | {
          _candidateSocket?: {
            close?: () => void;
            error$?: {
              subscribe: (listener: () => void) => { unsubscribe(): void };
            };
          };
        }
      | undefined
  )?._candidateSocket;
  // ws emits an asynchronous error when close() interrupts CONNECTING. Keep a
  // short-lived no-op subscriber so that expected cleanup cannot become an
  // uncaught process-level error after Univer disposes its own subscriptions.
  let errorSubscription: { unsubscribe(): void } | undefined;
  try {
    errorSubscription = candidate?.error$?.subscribe(() => {});
    candidate?.close?.();
  } catch {
    errorSubscription?.unsubscribe();
    return;
  }
  if (errorSubscription) {
    const timer = setTimeout(() => errorSubscription.unsubscribe(), 1_000);
    timer.unref?.();
  }
}

export function runDeferredCleanup(cleanups: Array<() => void>): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(() => {
      for (const cleanup of cleanups) {
        try {
          cleanup();
        } catch {
          // Teardown is best effort and must never mask the command result or
          // become an unhandled rejection during process shutdown.
        }
      }
      resolve();
    });
  });
}

function statusName(status: CollaborationStatus): string {
  return String(status).toUpperCase();
}

const INITIAL_STATUS_RECHECK_DELAY_MS = 25;

export async function waitUntil(
  status: () => CollaborationStatus,
  predicate: (value: CollaborationStatus) => boolean,
  timeoutMs: number,
  subscribe: (listener: (value: CollaborationStatus) => void) => {
    dispose(): void;
  },
  signal?: AbortSignal
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    // Univer reports OFFLINE briefly while loadSheetAsync finishes installing
    // the collaboration session. Treat only a transition back to OFFLINE as a
    // terminal disconnect; an initial OFFLINE must be allowed to progress.
    let sawNonOffline = false;
    let recheckTimer: ReturnType<typeof setTimeout> | undefined;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let subscription: { dispose(): void } | undefined;
    const onAbort = () =>
      finish(new Error('Univer collaboration synchronization interrupted.'));
    let recheckDelayMs = INITIAL_STATUS_RECHECK_DELAY_MS;

    const cleanup = () => {
      subscription?.dispose();
      if (recheckTimer) clearTimeout(recheckTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (result: string | Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const evaluate = (current: CollaborationStatus) => {
      if (settled) return;
      if (current !== CollaborationStatus.OFFLINE) sawNonOffline = true;
      if (predicate(current)) {
        finish(statusName(current));
      } else if (current === CollaborationStatus.CONFLICT) {
        finish(new Error('Univer collaboration conflict.'));
      } else if (current === CollaborationStatus.OFFLINE && sawNonOffline) {
        finish(new Error('Univer collaboration is offline.'));
      }
    };
    const scheduleRecheck = () => {
      recheckTimer = setTimeout(() => {
        evaluate(status());
        if (!settled) {
          recheckDelayMs = Math.min(recheckDelayMs * 2, 1_000);
          scheduleRecheck();
        }
      }, recheckDelayMs);
      recheckTimer.unref?.();
    };

    subscription = subscribe(evaluate);
    // Some adapters synchronously emit the current state from subscribe(). If
    // that settles the wait before assignment, dispose the newly returned
    // subscription immediately instead of leaving it attached.
    if (settled) {
      subscription.dispose();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    timeoutTimer = setTimeout(
      () =>
        finish(new Error('Univer collaboration synchronization timed out.')),
      timeoutMs
    );
    timeoutTimer.unref?.();
    // The Node collaboration adapter does not emit every status transition in
    // Univer 0.21.1. Events are the fast path; a bounded exponential probe is
    // the compatibility fallback and tops out at one check per second.
    scheduleRecheck();
    evaluate(status());
  });
}

export async function withUniverTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('Univer Sheet load timed out.')),
      timeoutMs
    );
    timer.unref?.();
  });
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error('Univer Sheet load was interrupted.'));
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, timeout, aborted]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

export async function openUniverSheet(
  options: OpenSheetOptions
): Promise<OpenUniverSheet> {
  options.signal?.throwIfAborted();
  const endpoint = validateUniverEndpoint(
    options.session.univer_endpoint,
    options.doczBaseUrl
  );
  const headers = {
    Authorization: `Bearer ${options.token}`,
    'X-Docz-Client': `docz-cli/${options.clientVersion}`,
    'X-Docz-Sheet-Unit': options.session.unit_id,
  };
  const SheetNodeSocketPlugin = createSheetNodeSocketPlugin(headers);
  const univer = new Univer({
    locale: LocaleType.EN_US,
    locales: {
      [LocaleType.EN_US]: { ...sheetsEnUS, ...collaborationEnUS },
    },
    logLevel: SHEET_UNIVER_LOG_LEVEL,
    // The collaboration client provides remote-aware implementations for
    // these core services. Remove the local defaults before plugin startup so
    // Redi sees exactly one binding for each identifier in Node.js.
    override: [
      [IAuthzIoService, null],
      [IUndoRedoService, null],
      [IMentionIOService, null],
    ],
  });
  forceUniverSilentLogging(univer);
  univer.registerPlugin(UniverNetworkPlugin);
  univer.registerPlugin(UniverFormulaEnginePlugin);
  univer.registerPlugin(UniverSheetsPlugin);
  const license = process.env.UNIVER_LICENSE?.trim();
  // The Node collaboration plugin expects the license plugin to be explicitly
  // registered before it, including in Univer's supported limited evaluation
  // mode. A commercial license is supplied only when real content is present.
  univer.registerPlugin(UniverLicensePlugin, license ? { license } : {});
  univer.registerPlugin(UniverCollaborationPlugin);
  univer.registerPlugin(UniverCollaborationClientPlugin, {
    socketService: NodeCollaborationSocketService,
    enableCollaboration: true,
    enableOfflineEditing: false,
    snapshotServerUrl: endpointPath(endpoint, '/universer-api/snapshot'),
    collabSubmitChangesetUrl: endpointPath(endpoint, '/universer-api/comb'),
    collabWebSocketUrl: websocketPath(endpoint, '/universer-api/comb/connect'),
    wsSessionTicketUrl: endpointPath(
      endpoint,
      '/universer-api/user/session-ticket'
    ),
    authzUrl: endpointPath(endpoint, '/universer-api/authz'),
    downloadEndpointUrl: endpoint.toString(),
    customHeaders: headers,
  });
  // Keep the official Node collaboration stack, replacing only its low-level
  // WebSocket transport with an implementation that can terminate CONNECTING
  // sockets safely when a short-lived CLI process exits.
  univer.registerPlugin(SheetNodeSocketPlugin, undefined);
  const univerAPI = FUniver.newAPI(univer);
  let disposePromise: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    if (disposePromise) return disposePromise;
    let collaborationSessions: CollaborationSessionService | undefined;
    try {
      collaborationSessions = univer
        .__getInjector()
        .get(CollaborationSessionService);
    } catch {
      // Plugin startup can fail before the collaboration service is bound.
    }
    closePendingCollaborationSocket(collaborationSessions);
    // ws reports an interrupted CONNECTING socket on nextTick. Keep Univer's
    // error subscriptions alive through that emission, then finish teardown.
    disposePromise = runDeferredCleanup([
      () => collaborationSessions?.closeSession(options.session.unit_id),
      () => collaborationSessions?.dispose(),
      () => {
        const socketService = univer.__getInjector().get(ISocketService) as {
          dispose?: () => void;
        };
        socketService.dispose?.();
      },
      () => univerAPI.disposeUnit(options.session.unit_id),
      () => univerAPI.dispose(),
      () => univer.dispose(),
    ]);
    return disposePromise;
  };
  try {
    const collaboration = univerAPI.getCollaboration();
    const workbook = await withUniverTimeout(
      collaboration.loadSheetAsync(options.session.unit_id),
      options.timeoutMs ?? 20_000,
      options.signal
    );
    if (!workbook) throw new Error('Univer Sheet was not found.');
    const currentStatus = () =>
      collaboration.getCollaborationStatus(options.session.unit_id);
    const subscribeStatus = (listener: (status: CollaborationStatus) => void) =>
      univerAPI.addEvent(
        univerAPI.Event.CollaborationStatusChanged,
        ({ unitId, status }) => {
          if (unitId === options.session.unit_id) listener(status);
        }
      );

    const resolveRange = (sheetName: string, a1: string) => {
      const sheet = workbook.getSheetByName(sheetName);
      if (!sheet) throw new Error(`Worksheet "${sheetName}" was not found.`);
      return sheet.getRange(a1);
    };
    const commandService = univer.__getInjector().get(ICommandService);
    const revisionService = univer.__getInjector().get(RevisionService);

    return {
      read: (sheetName, a1) => resolveRange(sheetName, a1).getValues(),
      write: async (sheetName, a1, values, onMutationMayHaveBeenSent) => {
        const sheet = workbook.getSheetByName(sheetName);
        if (!sheet) throw new Error(`Worksheet "${sheetName}" was not found.`);
        const range = sheet.getRange(a1).getRange();
        const value = covertCellValues(values as never[][], range);
        // All local target/range/value preparation is complete. From this
        // point the command may synchronously execute its primary mutation
        // before returning false or throwing in a later interceptor.
        onMutationMayHaveBeenSent?.();
        const success = await commandService.executeCommand(
          SetRangeValuesCommand.id,
          {
            unitId: workbook.getId(),
            subUnitId: sheet.getSheetId(),
            range,
            value,
          }
        );
        if (!success)
          throw new Error('Univer rejected the Sheet write command.');
      },
      status: () => statusName(currentStatus()),
      revision: () =>
        revisionService.getCurrentRevOfUnit(options.session.unit_id),
      waitForInitialSync: (timeoutMs = 20_000, signal?: AbortSignal) =>
        waitUntil(
          currentStatus,
          (value) => value === CollaborationStatus.SYNCED,
          timeoutMs,
          subscribeStatus,
          signal
        ),
      waitForWriteSync: (
        timeoutMs = 20_000,
        mutationStarted = () => true,
        mutationApplied = () => true,
        signal?: AbortSignal
      ) => {
        const startRevision = revisionService.getCurrentRevOfUnit(
          options.session.unit_id
        );
        let sawUnsynchronizedState = false;
        return waitUntil(
          currentStatus,
          (value) => {
            if (mutationStarted() && value !== CollaborationStatus.SYNCED) {
              sawUnsynchronizedState = true;
            }
            if (!mutationApplied()) return false;
            return (
              sawUnsynchronizedState &&
              value === CollaborationStatus.SYNCED &&
              revisionService.getCurrentRevOfUnit(options.session.unit_id) >
                startRevision
            );
          },
          timeoutMs,
          subscribeStatus,
          signal
        );
      },
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
