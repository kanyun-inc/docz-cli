import '@univerjs/sheets/facade';
import '@univerjs-pro/collaboration-client/facade';

import { LocaleType, LogLevel, Univer } from '@univerjs/core';
import { FUniver } from '@univerjs/core/facade';
import { UniverFormulaEnginePlugin } from '@univerjs/engine-formula';
import { UniverNetworkPlugin } from '@univerjs/network';
import { UniverSheetsPlugin } from '@univerjs/sheets';
import { UniverCollaborationPlugin } from '@univerjs-pro/collaboration';
import {
  CollaborationStatus,
  UniverCollaborationClientPlugin,
} from '@univerjs-pro/collaboration-client';
import {
  NodeCollaborationSocketService,
  UniverCollaborationClientNodePlugin,
} from '@univerjs-pro/collaboration-client-node';
import { UniverLicensePlugin } from '@univerjs-pro/license';
import type { OpenSheetOptions, OpenUniverSheet } from './types.js';

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

function statusName(status: CollaborationStatus): string {
  return String(status).toUpperCase();
}

async function waitUntil(
  status: () => CollaborationStatus,
  predicate: (value: CollaborationStatus, elapsedMs: number) => boolean,
  timeoutMs: number
): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const current = status();
    if (predicate(current, Date.now() - started)) return statusName(current);
    if (current === CollaborationStatus.CONFLICT) {
      throw new Error('Univer collaboration conflict.');
    }
    if (current === CollaborationStatus.OFFLINE) {
      throw new Error('Univer collaboration is offline.');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Univer collaboration synchronization timed out.');
}

export async function withUniverTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('Univer Sheet load timed out.')),
      timeoutMs
    );
    timer.unref?.();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function openUniverSheet(
  options: OpenSheetOptions
): Promise<OpenUniverSheet> {
  const endpoint = validateUniverEndpoint(
    options.session.univer_endpoint,
    options.doczBaseUrl
  );
  const headers = {
    Authorization: `Bearer ${options.token}`,
    'X-Docz-Client': `docz-cli/${options.clientVersion}`,
    'X-Docz-Sheet-Unit': options.session.unit_id,
  };
  const univer = new Univer({
    locale: LocaleType.EN_US,
    logLevel: LogLevel.ERROR,
  });
  univer.registerPlugin(UniverNetworkPlugin);
  univer.registerPlugin(UniverFormulaEnginePlugin);
  univer.registerPlugin(UniverSheetsPlugin);
  univer.registerPlugin(UniverLicensePlugin, {
    license: process.env.UNIVER_LICENSE || undefined,
  });
  univer.registerPlugin(UniverCollaborationPlugin);
  univer.registerPlugin(UniverCollaborationClientPlugin, {
    socketService: NodeCollaborationSocketService,
    enableCollaboration: true,
    enableOfflineEditing: false,
    enableAuthServer: false,
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
  univer.registerPlugin(UniverCollaborationClientNodePlugin);

  const univerAPI = FUniver.newAPI(univer);
  try {
    const collaboration = univerAPI.getCollaboration();
    const workbook = await withUniverTimeout(
      collaboration.loadSheetAsync(options.session.unit_id),
      options.timeoutMs ?? 20_000
    );
    if (!workbook) throw new Error('Univer Sheet was not found.');
    const currentStatus = () =>
      collaboration.getCollaborationStatus(options.session.unit_id);

    const resolveRange = (sheetName: string, a1: string) => {
      const sheet = workbook.getSheetByName(sheetName);
      if (!sheet) throw new Error(`Worksheet "${sheetName}" was not found.`);
      return sheet.getRange(a1);
    };

    return {
      read: (sheetName, a1) => resolveRange(sheetName, a1).getValues(),
      write: (sheetName, a1, values) => {
        resolveRange(sheetName, a1).setValues(values as never[][]);
      },
      status: () => statusName(currentStatus()),
      waitForInitialSync: (timeoutMs = 20_000) =>
        waitUntil(
          currentStatus,
          (value) => value === CollaborationStatus.SYNCED,
          timeoutMs
        ),
      waitForWriteSync: (timeoutMs = 20_000) => {
        let sawPending = false;
        return waitUntil(
          currentStatus,
          (value, elapsedMs) => {
            if (value !== CollaborationStatus.SYNCED) sawPending = true;
            return (
              value === CollaborationStatus.SYNCED &&
              (sawPending || elapsedMs >= 100)
            );
          },
          timeoutMs
        );
      },
      dispose: () => univer.dispose(),
    };
  } catch (error) {
    univer.dispose();
    throw error;
  }
}
