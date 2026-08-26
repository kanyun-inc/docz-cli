/**
 * CLI Commands
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import type { Command } from 'commander';
import {
  ConflictError,
  DocSyncClient,
  type LinkDiagnostic,
  MoveError,
  type ShareLinkInspection,
} from './client.js';
import { startCollabBridge } from './collab/bridge.js';
import { CollabRoomClient, withCollabRoom } from './collab/room.js';
import {
  CollabBaseHashRequiredError,
  CollabConflictError,
} from './collab/text.js';
import { type CollabOpenOptions, CollabUnknownError } from './collab/types.js';
import { getBaseUrl, getConfigPath, getToken, saveConfig } from './config.js';
import { registerLocalCommands } from './local.js';
import {
  classifySheetFailure,
  classifySheetWriteFailure,
} from './sheet/errors.js';
import { parseSheetRange, parseValuesMatrix } from './sheet/range.js';
import type {
  OpenUniverSheet,
  SheetCommandResult,
  SheetOpener,
  SheetOperation,
  SheetOutcome,
} from './sheet/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

declare const __VERSION__: string;

const DEFAULT_SHEET_PHASE_TIMEOUT_MS = 20_000;
const MAX_SHEET_PHASE_TIMEOUT_MS = 30_000;
const SHEET_OPERATION_SAFETY_MS = 5_000;

const lazyOpenUniverSheet: SheetOpener = async (options) => {
  const { openUniverSheet } = await import('./sheet/univer.js');
  return openUniverSheet(options);
};

function normalizeSheetTimeout(timeoutMs?: number): number {
  const value = timeoutMs ?? DEFAULT_SHEET_PHASE_TIMEOUT_MS;
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    throw new Error(
      'Sheet timeout must be a positive integer in milliseconds.'
    );
  }
  if (value > MAX_SHEET_PHASE_TIMEOUT_MS) {
    throw new Error(
      `Sheet timeout must not exceed ${MAX_SHEET_PHASE_TIMEOUT_MS}ms.`
    );
  }
  return value;
}

function operationPhaseTimeout(timeoutMs: number, deadlineAt: string): number {
  const remaining =
    Date.parse(deadlineAt) - Date.now() - SHEET_OPERATION_SAFETY_MS;
  if (!Number.isFinite(remaining) || remaining <= 0) {
    throw new Error('Sheet operation deadline has expired.');
  }
  return Math.max(1, Math.min(timeoutMs, remaining));
}

function remainingOperationTimeout(
  timeoutMs: number,
  deadlineAt: string,
  reserveMs = 0
): number {
  const remaining = Date.parse(deadlineAt) - Date.now() - reserveMs;
  if (!Number.isFinite(remaining) || remaining <= 0) return 0;
  return Math.max(1, Math.min(timeoutMs, remaining));
}

function sheetRequestSignal(timeoutMs: number): AbortSignal {
  return AbortSignal.timeout(Math.max(1, Math.floor(timeoutMs)));
}

function getClient(): DocSyncClient {
  const token = getToken();
  if (!token) {
    console.error(
      'Error: No token configured.\n' +
        'Run `docz login` or set DOCSYNC_API_TOKEN environment variable.'
    );
    process.exit(1);
  }
  return new DocSyncClient(getBaseUrl(), token);
}

function getOptionalClient(): DocSyncClient {
  return new DocSyncClient(getBaseUrl(), getToken() ?? '');
}

function getRequiredToken(): string {
  const token = getToken();
  if (!token) {
    console.error(
      'Error: No token configured.\n' +
        'Run `docz login` or set DOCSYNC_API_TOKEN environment variable.'
    );
    process.exit(1);
  }
  return token;
}

async function buildCollabOpenOptions(
  target: string,
  opts: { client?: string; clientVersion?: string; timeout?: number } = {}
): Promise<CollabOpenOptions> {
  const api = getClient();
  const { spaceId, path } = await resolveTarget(api, [target]);
  if (!path) {
    throw new Error('file path is required for collaborative editing');
  }
  return {
    baseUrl: getBaseUrl(),
    token: getRequiredToken(),
    spaceId,
    path,
    client: opts.client ?? 'docz-cli',
    clientVersion: opts.clientVersion ?? __VERSION__,
    timeoutMs: opts.timeout,
  };
}

/** Parse "space:path" or "space path" format */
export function parseTarget(args: string[]): { space: string; path: string } {
  if (args.length === 0) {
    console.error(
      'Error: space is required. Usage: docz <cmd> <space>[:<path>]'
    );
    process.exit(1);
  }
  const first = args[0];
  if (first.includes(':')) {
    const [space, ...rest] = first.split(':');
    return { space, path: rest.join(':') };
  }
  return { space: first, path: args.slice(1).join(' ') };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const INVALID_WINDOWS_PATH_CHARS = /[<>:"\\|?*]/;
const WINDOWS_DEVICE_NAME = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;

/** Validate a complete destination path relative to the Space root. */
export function validateDestinationPath(path: string): string | null {
  if (!path) return 'destination path is required';
  if (path.startsWith('/')) {
    return 'destination must be relative to the Space root';
  }

  for (const segment of path.split('/')) {
    if (!segment) return 'destination contains an empty path segment';
    if (segment === '.' || segment === '..') {
      return 'destination cannot contain "." or ".." segments';
    }
    if (Buffer.byteLength(segment, 'utf8') > 255) {
      return 'a destination path segment exceeds 255 UTF-8 bytes';
    }
    if ([...segment].some((char) => char.charCodeAt(0) <= 0x1f)) {
      return 'destination contains an ASCII control character';
    }
    if (INVALID_WINDOWS_PATH_CHARS.test(segment)) {
      return 'destination contains a character invalid on Windows';
    }
    if (segment.endsWith(' ') || segment.endsWith('.')) {
      return 'a destination path segment ends with a space or dot';
    }
    if (WINDOWS_DEVICE_NAME.test(segment)) {
      return 'destination contains a Windows reserved device name';
    }
  }
  return null;
}

export interface MoveFailurePresentation {
  lines: string[];
  exitCode: 1 | 2;
}

export function describeMoveFailure(
  err: unknown,
  spaceId: string,
  from: string,
  to: string
): MoveFailurePresentation {
  const detail =
    err instanceof MoveError
      ? err.detail
      : {
          error: 'move_status_unknown',
          message: err instanceof Error ? err.message : String(err),
          outcome: 'unknown' as const,
          old_path: from,
          new_path: to,
        };
  const oldPath = detail.old_path || from;
  const newPath = detail.new_path || to;
  const lines = [
    `Error: ${detail.message}`,
    `Resolved move: ${oldPath} → ${newPath}`,
  ];

  if (detail.error === 'destination_parent_not_found' && detail.parent_path) {
    lines.push(
      `Hint: create the parent first with \`docz mkdir ${spaceId}:${detail.parent_path}\`.`
    );
  }
  if (detail.outcome === 'unknown') {
    lines.push(
      'Outcome unknown: verify both source and destination paths before retrying.'
    );
  }

  return { lines, exitCode: detail.outcome === 'unknown' ? 2 : 1 };
}

// Share URL: /share/{token}
const SHARE_URL_RE = /\/share\/([^/?\s]+)/;

/** Resolve slug: try local spaces cache first, then API */
async function resolveSlug(
  client: DocSyncClient,
  slug: string
): Promise<{ id: string }> {
  try {
    const spaces = await client.listSpaces();
    const found = spaces.find((s) => s.slug === slug);
    if (found) return found;
  } catch {
    // fall through to by-slug API
  }
  return client.resolveBySlug(slug);
}

/**
 * Detect if input is a URL and resolve it to { spaceId, path }.
 * Supports:
 *   /s/{slug}/f/{fileId}         — short URL with fileId
 *   /s/{slug}[/path/to/file]     — slug URL with optional path
 *   /spaces/{spaceId}[/path/...] — legacy URL
 * Returns null if not a recognized DocSync URL.
 */
async function resolveUrl(
  client: DocSyncClient,
  input: string
): Promise<{ spaceId: string; path: string } | null> {
  let pathname: string;
  try {
    pathname = new URL(input).pathname;
  } catch {
    return null;
  }

  // /s/{slug}/f/{fileId}
  const fileMatch = pathname.match(/^\/s\/([^/]+)\/f\/([^/]+)$/);
  if (fileMatch) {
    const [, slug, fileId] = fileMatch;
    await resolveSlug(client, slug);
    const ref = await client.resolveFileRef(fileId);
    return { spaceId: ref.space_id, path: ref.path };
  }

  // /s/{slug}[/path/to/file]
  const slugMatch = pathname.match(/^\/s\/([^/]+)(\/.*)?$/);
  if (slugMatch) {
    const [, slug, rest] = slugMatch;
    const space = await resolveSlug(client, slug);
    const filePath = rest ? decodeURIComponent(rest.slice(1)) : '';
    return { spaceId: space.id, path: filePath };
  }

  // /spaces/{spaceId}[/path/to/file] (legacy)
  const legacyMatch = pathname.match(/^\/spaces\/([^/]+)(\/.*)?$/);
  if (legacyMatch) {
    const [, spaceId, rest] = legacyMatch;
    const filePath = rest ? decodeURIComponent(rest.slice(1)) : '';
    return { spaceId, path: filePath };
  }

  return null;
}

/**
 * Resolve target: if it's a URL, resolve it; otherwise use parseTarget + resolveSpace.
 */
export async function resolveTarget(
  client: DocSyncClient,
  args: string[]
): Promise<{ spaceId: string; path: string }> {
  const first = args[0];
  if (first && (first.startsWith('http://') || first.startsWith('https://'))) {
    const result = await resolveUrl(client, first);
    if (result) return result;
    throw new Error(
      `Unrecognized DocSync URL: ${first}\nExpected: /s/{slug}[/f/{fileId}], /s/{slug}[/path], or /spaces/{id}[/path]`
    );
  }
  const { space, path } = parseTarget(args);
  const s = await client.resolveSpace(space);
  return { spaceId: s.id, path };
}

function sheetExitCode(outcome: SheetOutcome): 0 | 1 | 2 {
  if (outcome === 'SYNCED') return 0;
  return outcome === 'FAILED' ? 1 : 2;
}

function printSheetResult(result: SheetCommandResult, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result));
    return;
  }
  if (result.values) {
    process.stdout.write(`${JSON.stringify(result.values, null, 2)}\n`);
  }
  console.error(
    `${result.outcome}: ${result.path} ${result.range} (${result.collaboration_status})`
  );
  if (result.warning) console.error(`Warning: ${result.warning}`);
  if (result.failure_code) console.error(`Failure: ${result.failure_code}`);
}

async function confirmSheetOperation(
  client: DocSyncClient,
  input: {
    spaceId: string;
    operationId: string;
    requestId: string;
    outcome: SheetOutcome;
    collaborationStatus: string;
    failureCode?: string;
    deadlineAt: string;
    timeoutMs: number;
    startRevision?: number;
    endRevision?: number;
    revisionVerified?: boolean;
  }
): Promise<SheetOutcome> {
  try {
    const finalizeTimeout = remainingOperationTimeout(
      Math.min(input.timeoutMs, 5_000),
      input.deadlineAt,
      1_000
    );
    if (finalizeTimeout === 0) return 'UNKNOWN';
    const finalized = await client.finalizeSheetOperation({
      spaceId: input.spaceId,
      operationId: input.operationId,
      outcome: input.outcome,
      collaborationStatus: input.collaborationStatus,
      failureCode: input.failureCode,
      startRevision: input.startRevision,
      endRevision: input.endRevision,
      revisionVerified: input.revisionVerified,
      signal: sheetRequestSignal(finalizeTimeout),
    });
    return finalized.outcome === 'PENDING' ? 'UNKNOWN' : finalized.outcome;
  } catch {
    try {
      const queryTimeout = remainingOperationTimeout(
        Math.min(input.timeoutMs, 5_000),
        input.deadlineAt
      );
      if (queryTimeout === 0) return 'UNKNOWN';
      const stored = await client.getSheetOperation(
        input.spaceId,
        input.requestId,
        sheetRequestSignal(queryTimeout)
      );
      return stored.outcome === 'PENDING' ? 'UNKNOWN' : stored.outcome;
    } catch {
      return 'UNKNOWN';
    }
  }
}

async function beginSheetOperationWithRecovery(
  client: DocSyncClient,
  input: {
    spaceId: string;
    path: string;
    requestId: string;
    clientVersion: string;
  },
  timeoutMs: number
): Promise<SheetOperation | undefined> {
  const localDeadline = Date.now() + timeoutMs;
  for (let attempt = 0; attempt < 2; attempt++) {
    const beginTimeout = Math.min(5_000, localDeadline - Date.now());
    if (beginTimeout <= 0) break;
    try {
      return await client.beginSheetOperation({
        ...input,
        signal: sheetRequestSignal(beginTimeout),
      });
    } catch {
      const queryTimeout = Math.min(5_000, localDeadline - Date.now());
      if (queryTimeout <= 0) break;
      try {
        return await client.getSheetOperation(
          input.spaceId,
          input.requestId,
          sheetRequestSignal(queryTimeout)
        );
      } catch {
        // The POST may not have reached the server. Retrying the same request ID
        // is safe and cannot create a second operation.
      }
    }
  }
  return undefined;
}

export async function executeSheetGet(input: {
  client: DocSyncClient;
  baseUrl: string;
  token: string;
  spaceId: string;
  path: string;
  range: string;
  clientVersion: string;
  timeoutMs?: number;
  opener?: SheetOpener;
}): Promise<SheetCommandResult> {
  const parsed = parseSheetRange(input.range);
  const timeoutMs = normalizeSheetTimeout(input.timeoutMs);
  const session = await input.client.getSheetSession(
    input.spaceId,
    input.path,
    sheetRequestSignal(timeoutMs)
  );
  let sheet: OpenUniverSheet | undefined;
  try {
    sheet = await (input.opener ?? lazyOpenUniverSheet)({
      session,
      doczBaseUrl: input.baseUrl,
      token: input.token,
      clientVersion: input.clientVersion,
      timeoutMs,
    });
    const collaborationStatus = await sheet.waitForInitialSync(timeoutMs);
    return {
      outcome: 'SYNCED',
      phase: 'read',
      space_id: session.space_id,
      path: session.path,
      unit_id: session.unit_id,
      collaboration_status: collaborationStatus,
      range: input.range,
      values: sheet.read(parsed.sheetName, parsed.a1),
    };
  } catch (error) {
    return {
      outcome: 'FAILED',
      phase: 'load',
      space_id: session.space_id,
      path: session.path,
      unit_id: session.unit_id,
      collaboration_status: sheet?.status() ?? 'UNAVAILABLE',
      range: input.range,
      failure_code: classifySheetFailure(error, 'sheet_read_failed'),
    };
  } finally {
    await sheet?.dispose();
  }
}

export async function executeSheetSet(input: {
  client: DocSyncClient;
  baseUrl: string;
  token: string;
  spaceId: string;
  path: string;
  range: string;
  valuesJson: string;
  clientVersion: string;
  timeoutMs?: number;
  opener?: SheetOpener;
  requestId?: string;
}): Promise<SheetCommandResult> {
  const parsed = parseSheetRange(input.range);
  const values = parseValuesMatrix(input.valuesJson, parsed);
  const timeoutMs = normalizeSheetTimeout(input.timeoutMs);
  const session = await input.client.getSheetSession(
    input.spaceId,
    input.path,
    sheetRequestSignal(timeoutMs)
  );
  if (!session.can_write) {
    return {
      outcome: 'FAILED',
      phase: 'write',
      space_id: session.space_id,
      path: session.path,
      unit_id: session.unit_id,
      collaboration_status: 'NOT_STARTED',
      range: input.range,
      failure_code: 'sheet_write_forbidden',
    };
  }

  const requestId = input.requestId ?? randomUUID();
  const operation = await beginSheetOperationWithRecovery(
    input.client,
    {
      spaceId: session.space_id,
      path: session.path,
      requestId,
      clientVersion: input.clientVersion,
    },
    timeoutMs
  );
  if (!operation) {
    return {
      outcome: 'FAILED',
      phase: 'load',
      space_id: session.space_id,
      path: session.path,
      unit_id: session.unit_id,
      collaboration_status: 'NOT_STARTED',
      request_id: requestId,
      range: input.range,
      failure_code: 'operation_begin_unconfirmed',
      warning:
        'No sheet mutation was attempted; use the request ID to inspect the audit operation before retrying.',
    };
  }
  if (
    operation.space_id !== session.space_id ||
    operation.file_ref_id !== session.file_ref_id ||
    operation.file_path !== session.path ||
    operation.unit_id !== session.unit_id
  ) {
    if (operation.outcome === 'PENDING') {
      await confirmSheetOperation(input.client, {
        spaceId: operation.space_id,
        operationId: operation.id,
        requestId,
        outcome: 'FAILED',
        collaborationStatus: 'NOT_STARTED',
        failureCode: 'sheet_identity_changed',
        deadlineAt: operation.deadline_at,
        timeoutMs,
      });
    }
    return {
      outcome: 'FAILED',
      phase: 'load',
      space_id: session.space_id,
      path: session.path,
      unit_id: session.unit_id,
      collaboration_status: 'NOT_STARTED',
      request_id: requestId,
      operation_id: operation.id,
      range: input.range,
      failure_code: 'sheet_identity_changed',
    };
  }
  if (operation.outcome !== 'PENDING') {
    return {
      outcome: operation.outcome,
      phase: 'confirm',
      space_id: session.space_id,
      path: session.path,
      unit_id: session.unit_id,
      collaboration_status:
        operation.last_collaboration_status || 'NOT_REOPENED',
      request_id: requestId,
      operation_id: operation.id,
      range: input.range,
      failure_code: operation.failure_code || undefined,
      ...(operation.outcome === 'UNKNOWN'
        ? {
            warning:
              'The existing request has an unknown outcome; reread the range before retrying.',
          }
        : {}),
    };
  }
  if (operation.execution_allowed !== true) {
    return {
      outcome: 'UNKNOWN',
      phase: 'confirm',
      space_id: session.space_id,
      path: session.path,
      unit_id: session.unit_id,
      collaboration_status: 'NOT_STARTED',
      request_id: requestId,
      operation_id: operation.id,
      range: input.range,
      failure_code: 'operation_execution_not_claimed',
      warning:
        'This request ID already exists or its create response was lost; no new mutation was sent. Inspect the operation and reread the range before retrying with a new request ID.',
    };
  }
  let sheet: OpenUniverSheet | undefined;
  let mutationMayHaveBeenSent = false;
  let writeStarted = false;
  let interrupted = false;
  const onSignal = () => {
    interrupted = true;
    void sheet?.dispose();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    sheet = await (input.opener ?? lazyOpenUniverSheet)({
      session,
      doczBaseUrl: input.baseUrl,
      token: input.token,
      clientVersion: input.clientVersion,
      timeoutMs: operationPhaseTimeout(timeoutMs, operation.deadline_at),
    });
    await sheet.waitForInitialSync(
      operationPhaseTimeout(timeoutMs, operation.deadline_at)
    );
    if (interrupted) throw new Error('interrupted');
    const startRevision = sheet.revision();
    let mutationApplied = false;
    // Arm collaboration observation before executing the mutation so a fast
    // PENDING -> SYNCED transition cannot be missed. The observer is gated
    // from the exact point the command may send a mutation, while completion is
    // gated until the local command returns. The initial SYNCED state is never
    // accepted as confirmation of this write.
    const writeSync = sheet.waitForWriteSync(
      operationPhaseTimeout(timeoutMs, operation.deadline_at),
      () => mutationMayHaveBeenSent,
      () => mutationApplied
    );
    // If the SDK rejects the local write, this observer is intentionally left
    // to settle during teardown/timeout. Attach a bounded sink immediately so
    // that later rejection cannot become an unhandled promise rejection.
    void writeSync.catch(() => undefined);
    writeStarted = true;
    await sheet.write(parsed.sheetName, parsed.a1, values, () => {
      mutationMayHaveBeenSent = true;
    });
    mutationApplied = true;
    const collaborationStatus = await writeSync;
    const endRevision = sheet.revision();
    const revisionVerified = endRevision > startRevision;
    const outcome = await confirmSheetOperation(input.client, {
      spaceId: session.space_id,
      operationId: operation.id,
      requestId,
      outcome: 'SYNCED',
      collaborationStatus,
      startRevision,
      endRevision,
      revisionVerified,
      deadlineAt: operation.deadline_at,
      timeoutMs,
    });
    return {
      outcome,
      phase: 'confirm',
      space_id: session.space_id,
      path: session.path,
      unit_id: session.unit_id,
      collaboration_status: collaborationStatus,
      request_id: requestId,
      operation_id: operation.id,
      range: input.range,
      ...(outcome === 'UNKNOWN'
        ? {
            warning:
              'Write confirmation was lost; reread the range before retrying.',
          }
        : {}),
    };
  } catch (error) {
    const collaborationStatus = sheet?.status() ?? 'UNAVAILABLE';
    const failureCode = interrupted
      ? mutationMayHaveBeenSent
        ? 'interrupted_after_mutation'
        : 'interrupted_before_mutation'
      : mutationMayHaveBeenSent
        ? classifySheetWriteFailure(error)
        : writeStarted
          ? classifySheetWriteFailure(error)
          : classifySheetFailure(error, 'initial_load_failed');
    // Univer's SetRangeValuesCommand may return false after its primary cell
    // mutation succeeded but a later interceptor/redo failed. Once write() was
    // invoked, even an apparently definite command rejection is therefore
    // conservatively UNKNOWN until a reread proves the resulting values.
    const mutationOutcomeUnknown = mutationMayHaveBeenSent;
    const requestedOutcome: SheetOutcome = mutationOutcomeUnknown
      ? 'UNKNOWN'
      : 'FAILED';
    const outcome = await confirmSheetOperation(input.client, {
      spaceId: session.space_id,
      operationId: operation.id,
      requestId,
      outcome: requestedOutcome,
      collaborationStatus,
      failureCode,
      deadlineAt: operation.deadline_at,
      timeoutMs,
    });
    return {
      outcome:
        mutationOutcomeUnknown && outcome === 'FAILED' ? 'UNKNOWN' : outcome,
      phase: mutationOutcomeUnknown
        ? 'confirm'
        : writeStarted
          ? 'write'
          : 'load',
      space_id: session.space_id,
      path: session.path,
      unit_id: session.unit_id,
      collaboration_status: collaborationStatus,
      request_id: requestId,
      operation_id: operation.id,
      range: input.range,
      failure_code: failureCode,
      ...(mutationOutcomeUnknown
        ? {
            warning:
              'Write may have been sent; reread the range before retrying.',
          }
        : {}),
    };
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    await sheet?.dispose();
  }
}

/**
 * Resolve a space argument that may be a name, UUID, or URL.
 * For URLs, delegates to resolveUrl and extracts the spaceId.
 */
export async function resolveSpaceArg(
  client: DocSyncClient,
  input: string
): Promise<{ id: string }> {
  if (input.startsWith('http://') || input.startsWith('https://')) {
    const result = await resolveUrl(client, input);
    if (result) return { id: result.spaceId };
    throw new Error(
      `Unrecognized DocSync URL: ${input}\nExpected: /s/{slug}[/f/{fileId}], /s/{slug}[/path], or /spaces/{id}[/path]`
    );
  }
  return client.resolveSpace(input);
}

/** Parse relative duration (7d, 24h, 30d) to RFC3339 */
export function parseExpires(value: string): string {
  const match = value.match(/^(\d+)([dh])$/);
  if (!match)
    throw new Error(
      `Invalid expires format: "${value}". Use e.g. 7d, 24h, 30d`
    );
  const [, num, unit] = match;
  const ms = unit === 'd' ? Number(num) * 86400000 : Number(num) * 3600000;
  return new Date(Date.now() + ms).toISOString();
}

/** Extract share token from URL or return as-is */
export function extractShareToken(input: string): string {
  const m = input.match(SHARE_URL_RE);
  if (m) return m[1];
  return input;
}

export type NormalLinkTarget =
  | {
      kind: 'file-ref';
      slug: string;
      fileId: string;
      path: '';
    }
  | {
      kind: 'path';
      slug?: string;
      spaceId?: string;
      path: string;
    };

export interface NormalLinkInfo {
  link_type: 'normal';
  link_status: 'valid' | 'invalid' | 'unknown';
  space_permission:
    | 'accessible'
    | 'inaccessible'
    | 'not_applicable'
    | 'unknown';
  document_path: string | null;
  document_status: 'exists' | 'not_found' | 'not_applicable' | 'unknown';
  space_admin: { name: string | null; email: string | null } | null;
  is_folder: boolean | null;
}

export interface ShareLinkInfo {
  link_status: 'valid' | 'invalid' | 'expired' | 'unknown';
  access_status: 'accessible' | 'login_required' | 'forbidden' | 'unknown';
  visibility: 'public' | 'restricted' | null;
  space_name: string | null;
  document_path: string | null;
  document_status: 'exists' | 'not_found' | 'unknown';
  role: string | null;
  shared_by: string | null;
  expires_at: string | null;
  is_folder: boolean | null;
  has_space_access: boolean | null;
}

function decodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`Invalid URL path encoding: ${value}`);
  }
}

/** Parse a normal Docz URL without making a network request. */
export function parseNormalLink(input: string): NormalLinkTarget {
  let pathname: string;
  try {
    pathname = new URL(input).pathname;
  } catch {
    throw new Error('Expected a full ordinary Docz URL');
  }

  if (SHARE_URL_RE.test(pathname)) {
    throw new Error('Share links must use `docz share info`');
  }

  const fileMatch = pathname.match(/^\/s\/([^/]+)\/f\/([^/]+)\/?$/);
  if (fileMatch) {
    return {
      kind: 'file-ref',
      slug: decodePath(fileMatch[1]),
      fileId: decodePath(fileMatch[2]),
      path: '',
    };
  }

  const slugMatch = pathname.match(/^\/s\/([^/]+)(\/.*)?$/);
  if (slugMatch) {
    return {
      kind: 'path',
      slug: decodePath(slugMatch[1]),
      path: slugMatch[2] ? decodePath(slugMatch[2].slice(1)) : '',
    };
  }

  const legacyMatch = pathname.match(/^\/spaces\/([^/]+)(\/.*)?$/);
  if (legacyMatch) {
    return {
      kind: 'path',
      spaceId: decodePath(legacyMatch[1]),
      path: legacyMatch[2] ? decodePath(legacyMatch[2].slice(1)) : '',
    };
  }

  throw new Error(
    'Unrecognized ordinary Docz URL. Expected /s/{slug}[/f/{fileId}], /s/{slug}[/path], or /spaces/{id}[/path]'
  );
}

export function mapNormalLinkInfo(diagnostic: LinkDiagnostic): NormalLinkInfo {
  const documentPath =
    !diagnostic.link_valid || diagnostic.path === undefined
      ? null
      : diagnostic.path === ''
        ? '/'
        : `/${diagnostic.path}`;
  const documentStatus = !diagnostic.link_valid
    ? 'unknown'
    : !diagnostic.document_applicable
      ? 'not_applicable'
      : diagnostic.document_exists
        ? 'exists'
        : 'not_found';

  return {
    link_type: 'normal',
    link_status: diagnostic.link_valid ? 'valid' : 'invalid',
    space_permission: !diagnostic.space_exists
      ? 'not_applicable'
      : diagnostic.has_space_access
        ? 'accessible'
        : 'inaccessible',
    document_path: documentPath,
    document_status: documentStatus,
    space_admin:
      diagnostic.owner_name !== undefined ||
      diagnostic.owner_email !== undefined
        ? {
            name: diagnostic.owner_name ?? null,
            email: diagnostic.owner_email ?? null,
          }
        : null,
    is_folder:
      typeof diagnostic.is_dir === 'boolean' ? diagnostic.is_dir : null,
  };
}

export function mapShareLinkInfo(
  inspection: ShareLinkInspection
): ShareLinkInfo {
  const info = inspection.info;
  return {
    link_status: inspection.link_status,
    access_status: inspection.access_status,
    visibility: info ? (info.is_public ? 'public' : 'restricted') : null,
    space_name: info?.space_name ?? null,
    document_path: info
      ? info.file_path === ''
        ? '/'
        : `/${info.file_path}`
      : null,
    document_status: info
      ? info.document_exists
        ? 'exists'
        : 'not_found'
      : 'unknown',
    role: info?.role ?? null,
    shared_by: info?.created_by_name ?? null,
    expires_at: info?.expires_at ?? null,
    is_folder: info?.is_dir ?? null,
    has_space_access: info?.has_space_access ?? null,
  };
}

function unknownNormalLinkInfo(): NormalLinkInfo {
  return {
    link_type: 'normal',
    link_status: 'unknown',
    space_permission: 'unknown',
    document_path: null,
    document_status: 'unknown',
    space_admin: null,
    is_folder: null,
  };
}

function unknownShareLinkInfo(): ShareLinkInfo {
  return {
    link_status: 'unknown',
    access_status: 'unknown',
    visibility: null,
    space_name: null,
    document_path: null,
    document_status: 'unknown',
    role: null,
    shared_by: null,
    expires_at: null,
    is_folder: null,
    has_space_access: null,
  };
}

function formatNullable(value: string | boolean | null): string {
  return value === null ? 'unknown' : String(value);
}

/** Read all of stdin into a string */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

const MAX_SAVE_SIZE = 2 * 1024 * 1024; // 2MB

// --- Image upload (shared by CLI command and MCP tool) ---

export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp'];
export const IMAGE_MAX_SIZE = 5 * 1024 * 1024; // 5MB, same as server limit

/**
 * Validate and read a local image file for upload.
 * Returns { content, filename } on success, or { error } describing
 * why the file was rejected (no request is sent in that case).
 */
export function readImageFile(
  filePath: string
): { content: Buffer; filename: string } | { error: string } {
  if (!existsSync(filePath)) {
    return { error: `File not found: ${filePath}` };
  }
  const filename = basename(filePath);
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (!IMAGE_EXTS.includes(ext)) {
    return {
      error: `Unsupported image type ".${ext}". Supported: ${IMAGE_EXTS.join(', ')}`,
    };
  }
  const size = statSync(filePath).size;
  if (size > IMAGE_MAX_SIZE) {
    return {
      error: `Image too large (${formatSize(size)}). Max size: 5 MB`,
    };
  }
  return { content: readFileSync(filePath), filename };
}

/** Markdown image reference with the filename (minus extension) as alt text */
export function markdownImageRef(filename: string, url: string): string {
  const alt = filename.replace(/\.[^.]+$/, '');
  return `![${alt}](${url})`;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export function registerCommands(program: Command): void {
  registerLocalCommands(program);

  // --- login ---
  program
    .command('login')
    .description('Configure DocSync credentials')
    .option('-u, --url <url>', 'DocSync server URL')
    .option('-t, --token <token>', 'API token')
    .action(async (opts) => {
      const url = opts.url ?? getBaseUrl();
      const token = opts.token;
      if (!token) {
        console.error(
          'Error: --token is required.\n' +
            'Get one at: ' +
            url +
            ' → Settings → API Tokens'
        );
        process.exit(1);
      }
      const client = new DocSyncClient(url, token);
      try {
        const user = await client.me();
        saveConfig(url, token);
        console.log(`Logged in as ${user.name} (${user.email})`);
        console.log(`Config saved to ${getConfigPath()}`);
      } catch (err) {
        console.error(
          `Error: ${err instanceof Error ? err.message : String(err)}`
        );
        process.exit(1);
      }
    });

  // --- whoami ---
  program
    .command('whoami')
    .description('Show current user')
    .action(async () => {
      const client = getClient();
      const user = await client.me();
      console.log(`${user.name} (${user.email})`);
    });

  // --- spaces ---
  program
    .command('spaces')
    .description('List all accessible spaces')
    .action(async () => {
      const client = getClient();
      const spaces = await client.listSpaces();
      for (const s of spaces) {
        const tag = s.is_private ? 'private' : 'team';
        console.log(
          `${s.name}\t${tag}\t${s.member_count} members\t${s.id}\t${s.slug ?? ''}`
        );
      }
    });

  // --- ls ---
  program
    .command('ls')
    .description('List files — docz ls <space>[:<path>] or <url>')
    .argument('<target...>')
    .option('-R, --recursive', 'Recursively list all files')
    .action(async (args: string[], opts: { recursive?: boolean }) => {
      const client = getClient();
      const { spaceId, path } = await resolveTarget(client, args);
      if (opts.recursive) {
        const entries = await client.treeFull(spaceId, path);
        if (entries.length === 0) {
          console.log('(empty)');
          return;
        }
        for (const e of entries) {
          if (e.type === 'tree') {
            console.log(`${e.path}/`);
          } else {
            console.log(`${e.path}\t${formatSize(e.size)}`);
          }
        }
      } else {
        const entries = await client.ls(spaceId, path);
        if (entries.length === 0) {
          console.log('(empty)');
          return;
        }
        for (const e of entries) {
          if (e.type === 'tree') {
            console.log(`${e.name}/`);
          } else {
            console.log(`${e.name}\t${formatSize(e.size)}`);
          }
        }
      }
    });

  // --- cat ---
  program
    .command('cat')
    .description('Read file content — docz cat <space>:<path> or <url>')
    .argument('<target...>')
    .option('--ref', 'Also output Git ref to stderr')
    .action(async (args: string[], opts: { ref?: boolean }) => {
      const client = getClient();
      const { spaceId, path } = await resolveTarget(client, args);
      if (!path) {
        console.error(
          'Error: file path is required. Usage: docz cat <space>:<path>'
        );
        process.exit(1);
      }
      if (opts.ref) {
        const result = await client.catWithRef(spaceId, path);
        console.error(`ref: ${result.ref}`);
        process.stdout.write(result.content);
      } else {
        const content = await client.cat(spaceId, path);
        process.stdout.write(content);
      }
    });

  // --- upload ---
  program
    .command('upload')
    .description(
      'Upload file — docz upload <local-file> <space>[:<dir>] or <url>'
    )
    .argument('<file>', 'Local file to upload')
    .argument('<target...>')
    .action(async (file: string, args: string[]) => {
      const client = getClient();
      const { spaceId, path: dir } = await resolveTarget(client, args);
      const content = readFileSync(file);
      const filename = basename(file);
      const targetDir = dir || '';
      const result = await client.upload(spaceId, targetDir, filename, content);
      console.log(`Uploaded: ${result.path}`);
    });

  // --- image ---
  const image = program.command('image').description('Image asset operations');

  image
    .command('upload')
    .description(
      'Upload image to OSS, returns a permanent public URL for Markdown embedding'
    )
    .argument('<file>', 'Local image file (png/jpg/webp, max 5MB)')
    .action(async (file: string) => {
      const read = readImageFile(file);
      if ('error' in read) {
        console.error(`Error: ${read.error}`);
        process.exit(1);
      }
      const client = getClient();
      const result = await client.uploadImage(read.content, read.filename);
      console.log(`URL: ${result.url}`);
      console.log(`Markdown: ${markdownImageRef(read.filename, result.url)}`);
    });

  // --- write ---
  program
    .command('write')
    .description(
      'Write content to file — docz write <space>:<path> <content> or <url> <content>'
    )
    .argument('<target>', 'space:dir/filename.md or short URL')
    .argument('<content>', 'File content (or - for stdin)')
    .option('--force', 'Skip conflict detection')
    .option('-m, --message <msg>', 'Custom commit message')
    .action(
      async (
        target: string,
        content: string,
        opts: { force?: boolean; message?: string }
      ) => {
        const client = getClient();
        const { spaceId, path } = await resolveTarget(client, [target]);
        if (!path) {
          console.error(
            'Error: path is required. Usage: docz write <space>:<dir/filename> <content>'
          );
          process.exit(1);
        }
        const body = content === '-' ? await readStdin() : content;

        if (Buffer.byteLength(body, 'utf-8') > MAX_SAVE_SIZE) {
          console.error(
            'Error: content exceeds 2MB limit. Use `docz upload` for large files.'
          );
          process.exit(1);
        }

        let baseRef: string | undefined;
        if (!opts.force) {
          try {
            const existing = await client.catWithRef(spaceId, path);
            baseRef = existing.ref;
          } catch (err) {
            const msg = err instanceof Error ? err.message : '';
            if (!msg.includes('404')) throw err;
          }
        }

        try {
          const result = await client.save(spaceId, path, body, {
            baseRef,
            message: opts.message,
          });
          console.log(`Written: ${result.path} (ref: ${result.ref})`);
        } catch (err) {
          if (err instanceof ConflictError) {
            console.error(
              'Error: file was modified by someone else. Please re-read the latest content and try again.'
            );
            process.exit(1);
          }
          throw err;
        }
      }
    );

  // --- mkdir ---
  program
    .command('mkdir')
    .description('Create folder — docz mkdir <space>:<path> or <url>')
    .argument('<target...>')
    .action(async (args: string[]) => {
      const client = getClient();
      const { spaceId, path } = await resolveTarget(client, args);
      if (!path) {
        console.error('Error: path is required.');
        process.exit(1);
      }
      await client.mkdir(spaceId, path);
      console.log(`Created: ${path}`);
    });

  // --- rm ---
  program
    .command('rm')
    .description('Delete file/folder — docz rm <space>:<path> or <url>')
    .argument('<target...>')
    .action(async (args: string[]) => {
      const client = getClient();
      const { spaceId, path } = await resolveTarget(client, args);
      if (!path) {
        console.error('Error: path is required.');
        process.exit(1);
      }
      await client.rm(spaceId, path);
      console.log(`Deleted: ${path} (recoverable from trash for 30 days)`);
    });

  // --- mv ---
  program
    .command('mv')
    .description(
      'Rename or move within a Space — destination is a full Space-root-relative path'
    )
    .argument('<source>', 'space:source-path or Docz URL')
    .argument(
      '<destination-path>',
      'full path relative to the Space root, including the final name'
    )
    .action(async (source: string, destinationPath: string) => {
      const invalidReason = validateDestinationPath(destinationPath);
      if (invalidReason) {
        console.error(`Error: invalid destination path: ${invalidReason}.`);
        process.exitCode = 1;
        return;
      }

      const client = getClient();
      const { spaceId, path: from } = await resolveTarget(client, [source]);
      if (!from) {
        console.error('Error: source path is required.');
        process.exitCode = 1;
        return;
      }
      try {
        await client.mv(spaceId, from, destinationPath);
      } catch (err) {
        const presentation = describeMoveFailure(
          err,
          spaceId,
          from,
          destinationPath
        );
        for (const line of presentation.lines) console.error(line);
        process.exitCode = presentation.exitCode;
        return;
      }
      console.log(`Moved: ${from} → ${destinationPath}`);
    });

  // --- log ---
  program
    .command('log')
    .description('Show change history — docz log <space>[:<path>] or <url>')
    .argument('<target...>')
    .action(async (args: string[]) => {
      const client = getClient();
      const { spaceId, path } = await resolveTarget(client, args);
      const logs = await client.log(spaceId, path || undefined);
      if (logs.length === 0) {
        console.log('No history.');
        return;
      }
      for (const l of logs) {
        console.log(`${l.hash}  ${l.date}  ${l.author}  ${l.message}`);
      }
    });

  // --- rollback ---
  program
    .command('rollback')
    .description(
      'Rollback file to a previous version — docz rollback <space>:<path> <commit> or <url> <commit>'
    )
    .argument('<target>', 'space:path or short URL')
    .argument('<commit>', 'Commit hash to rollback to')
    .action(async (target: string, commit: string) => {
      const client = getClient();
      const { spaceId, path } = await resolveTarget(client, [target]);
      if (!path) {
        console.error('Error: file path is required.');
        process.exit(1);
      }
      await client.rollback(spaceId, path, commit);
      console.log(`Rolled back: ${path} → ${commit.substring(0, 7)}`);
    });

  // --- trash ---
  program
    .command('trash')
    .description('Show deleted files — docz trash <space>')
    .argument('<space>')
    .action(async (spaceName: string) => {
      const client = getClient();
      const s = await resolveSpaceArg(client, spaceName);
      const items = await client.trash(s.id);
      if (items.length === 0) {
        console.log('Trash is empty.');
        return;
      }
      for (const t of items) {
        console.log(
          `${t.path}\tdeleted ${t.deleted_at}\t${t.commit.substring(0, 7)}`
        );
      }
    });

  // --- restore ---
  program
    .command('restore')
    .description(
      'Restore file from trash — docz restore <space>:<path> <commit> or <url> <commit>'
    )
    .argument('<target>', 'space:path or short URL')
    .argument('<commit>', 'Commit hash from trash listing')
    .action(async (target: string, commit: string) => {
      const client = getClient();
      const { spaceId, path } = await resolveTarget(client, [target]);
      if (!path) {
        console.error('Error: path is required.');
        process.exit(1);
      }
      await client.restore(spaceId, path, commit);
      console.log(`Restored: ${path}`);
    });

  // --- comment ---
  const comment = program
    .command('comment')
    .description('Manage file comments');

  comment
    .command('list')
    .description('List comments — docz comment list <space>:<path>')
    .argument('<target...>')
    .action(async (args: string[]) => {
      const client = getClient();
      const { spaceId, path } = await resolveTarget(client, args);
      if (!path) {
        console.error('Error: file path is required.');
        process.exit(1);
      }
      const comments = await client.listComments(spaceId, path);
      if (comments.length === 0) {
        console.log('No comments.');
        return;
      }
      for (const c of comments) {
        const status = c.is_closed ? ' [closed]' : '';
        console.log(`#${c.id} ${c.user_name} (${c.created_at})${status}`);
        if (c.target_content) {
          console.log(`  > ${c.target_content}`);
        }
        console.log(`  ${c.content}`);
        for (const r of c.replies) {
          console.log(`    → ${r.user_name}: ${r.content}`);
        }
      }
    });

  comment
    .command('add')
    .description(
      'Add comment — docz comment add <space>:<path> <content> or <url> <content>'
    )
    .argument('<target>', 'space:path or short URL')
    .argument('<content>', 'Comment text (or - for stdin)')
    .option(
      '--quote <text>',
      'Quote text from the file (selection comment). The quoted text will be highlighted in Web UI'
    )
    .action(
      async (target: string, content: string, opts: { quote?: string }) => {
        const client = getClient();
        const { spaceId, path } = await resolveTarget(client, [target]);
        if (!path) {
          console.error('Error: file path is required.');
          process.exit(1);
        }
        const body = content === '-' ? await readStdin() : content;
        const c = await client.createComment(spaceId, path, body, {
          quote: opts.quote,
        });
        console.log(`Comment #${c.id} created.`);
      }
    );

  comment
    .command('reply')
    .description(
      'Reply to comment — docz comment reply <space> <commentId> <content>'
    )
    .argument('<space>')
    .argument('<commentId>')
    .argument('<content>', 'Reply text (or - for stdin)')
    .action(async (spaceName: string, commentId: string, content: string) => {
      const client = getClient();
      const s = await resolveSpaceArg(client, spaceName);
      const body = content === '-' ? await readStdin() : content;
      const r = await client.replyComment(s.id, Number(commentId), body);
      console.log(`Reply #${r.id} created.`);
    });

  comment
    .command('close')
    .description('Close comment — docz comment close <space> <commentId>')
    .argument('<space>')
    .argument('<commentId>')
    .action(async (spaceName: string, commentId: string) => {
      const client = getClient();
      const s = await resolveSpaceArg(client, spaceName);
      await client.closeComment(s.id, Number(commentId));
      console.log(`Comment #${commentId} closed.`);
    });

  comment
    .command('rm')
    .description('Delete comment — docz comment rm <space> <commentId>')
    .argument('<space>')
    .argument('<commentId>')
    .action(async (spaceName: string, commentId: string) => {
      const client = getClient();
      const s = await resolveSpaceArg(client, spaceName);
      await client.deleteComment(s.id, Number(commentId));
      console.log(`Comment #${commentId} deleted.`);
    });

  // --- ordinary link metadata ---
  const link = program
    .command('link')
    .description('Inspect ordinary Docz links');

  link
    .command('info')
    .description('Show ordinary link metadata — docz link info <url>')
    .argument('<url>', 'Ordinary Docz URL')
    .option('--json', 'Output machine-readable JSON')
    .action(async (url: string, opts: { json?: boolean }) => {
      const target = parseNormalLink(url);
      const client = getClient();
      let result: NormalLinkInfo;
      try {
        const diagnostic =
          target.kind === 'file-ref'
            ? await client.diagnoseFileRef(target.fileId, target.slug)
            : await client.diagnosePath({
                slug: target.slug,
                spaceId: target.spaceId,
                path: target.path,
              });
        result = mapNormalLinkInfo(diagnostic);
      } catch (err) {
        result = unknownNormalLinkInfo();
        process.exitCode = 2;
        console.error(
          `Warning: link diagnostic failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      if (opts.json) {
        console.log(JSON.stringify(result));
        return;
      }
      console.log(`Link type:        ${result.link_type}`);
      console.log(`Link status:      ${result.link_status}`);
      console.log(`Space permission: ${result.space_permission}`);
      console.log(`Document path:     ${formatNullable(result.document_path)}`);
      console.log(`Document status:   ${result.document_status}`);
      const admin = result.space_admin;
      console.log(
        `Space admin:       ${
          admin
            ? [admin.name, admin.email].filter(Boolean).join(' <') +
              (admin.name && admin.email ? '>' : '')
            : 'unknown'
        }`
      );
      console.log(`Folder:            ${formatNullable(result.is_folder)}`);
    });

  // --- share ---
  const share = program.command('share').description('Manage share links');

  share
    .command('create')
    .description(
      'Create share link — docz share create <space>:<path> or <url>'
    )
    .argument('<target>', 'space:path or short URL')
    .option('--expires <duration>', 'Expiry duration (e.g. 7d, 24h)')
    .option('--users <emails>', 'Comma-separated user emails or IDs')
    .option('--groups <ids>', 'Comma-separated group IDs')
    .action(
      async (
        target: string,
        opts: { expires?: string; users?: string; groups?: string }
      ) => {
        const client = getClient();
        const { spaceId, path } = await resolveTarget(client, [target]);
        if (!path) {
          console.error(
            'Error: file path is required. Usage: docz share create <space>:<path>'
          );
          process.exit(1);
        }
        const apiOpts: {
          expiresAt?: string;
          userIds?: string[];
          groupIds?: string[];
        } = {};
        if (opts.expires) apiOpts.expiresAt = parseExpires(opts.expires);
        if (opts.users)
          apiOpts.userIds = opts.users.split(',').map((s) => s.trim());
        if (opts.groups)
          apiOpts.groupIds = opts.groups.split(',').map((s) => s.trim());
        const link = await client.createShareLink(spaceId, path, apiOpts);
        const baseUrl = getBaseUrl();
        console.log('Created share link:');
        console.log(`  id:      ${link.id}`);
        console.log(`  token:   ${link.token}`);
        console.log(`  url:     ${baseUrl}/share/${link.token}`);
        console.log(`  expires: ${link.expires_at ?? 'never'}`);
        if (link.user_ids?.length)
          console.log(`  users:   ${link.user_ids.join(', ')}`);
        if (link.group_ids?.length)
          console.log(`  groups:  ${link.group_ids.length}`);
      }
    );

  share
    .command('list')
    .description('List share links — docz share list <space>')
    .argument('<space>')
    .option('--file <path>', 'Filter by file path')
    .action(async (spaceName: string, opts: { file?: string }) => {
      const client = getClient();
      const s = await resolveSpaceArg(client, spaceName);
      const links = await client.listShareLinks(s.id, opts.file);
      if (links.length === 0) {
        console.log('No share links.');
        return;
      }
      for (const l of links) {
        const expires = l.expires_at ?? 'never';
        const creator = l.created_by_name ?? l.created_by_email ?? l.created_by;
        console.log(
          `${l.id}\t${l.token}\t${l.file_path}\t${expires}\t${creator}`
        );
      }
    });

  share
    .command('update')
    .description('Update share link — docz share update <space> <link-id>')
    .argument('<space>')
    .argument('<linkId>')
    .option('--expires <duration>', 'New expiry duration (e.g. 30d)')
    .option('--users <emails>', 'Comma-separated user emails or IDs')
    .option('--groups <ids>', 'Comma-separated group IDs')
    .action(
      async (
        spaceName: string,
        linkId: string,
        opts: { expires?: string; users?: string; groups?: string }
      ) => {
        const client = getClient();
        const s = await resolveSpaceArg(client, spaceName);
        const apiOpts: {
          expiresAt?: string;
          userIds?: string[];
          groupIds?: string[];
        } = {};
        if (opts.expires) apiOpts.expiresAt = parseExpires(opts.expires);
        if (opts.users)
          apiOpts.userIds = opts.users.split(',').map((s) => s.trim());
        if (opts.groups)
          apiOpts.groupIds = opts.groups.split(',').map((s) => s.trim());
        await client.updateShareLink(s.id, linkId, apiOpts);
        console.log(`Updated share link: ${linkId}`);
      }
    );

  share
    .command('cat')
    .description('Read shared file — docz share cat <token-or-url>')
    .argument('<token>', 'Share token or full URL')
    .option('--raw', 'Output raw content only')
    .action(async (tokenArg: string, opts: { raw?: boolean }) => {
      const client = getClient();
      const token = extractShareToken(tokenArg);
      if (!opts.raw) {
        try {
          const info = await client.getSharedFileInfo(token);
          console.log(`File: ${info.file_path} (${info.space_name})`);
          console.log(
            `Shared by: ${info.created_by_name} | Expires: ${info.expires_at ?? 'never'}`
          );
          console.log('---');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes('404')) {
            console.error(`Warning: failed to fetch share info: ${msg}`);
          }
        }
      }
      const content = await client.getSharedFile(token);
      process.stdout.write(content);
    });

  share
    .command('info')
    .description('Show share link info — docz share info <token-or-url>')
    .argument('<token>', 'Share token or full URL')
    .option('--json', 'Output machine-readable JSON')
    .action(async (tokenArg: string, opts: { json?: boolean }) => {
      try {
        const pathname = new URL(tokenArg).pathname;
        if (/^\/(?:s|spaces)\//.test(pathname)) {
          throw new Error('Ordinary links must use `docz link info`');
        }
      } catch (err) {
        if (
          err instanceof Error &&
          err.message === 'Ordinary links must use `docz link info`'
        ) {
          throw err;
        }
      }

      const client = getOptionalClient();
      const token = extractShareToken(tokenArg);
      let result: ShareLinkInfo;
      try {
        result = mapShareLinkInfo(await client.inspectShareLink(token));
      } catch (err) {
        result = unknownShareLinkInfo();
        process.exitCode = 2;
        console.error(
          `Warning: share diagnostic failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      if (opts.json) {
        console.log(JSON.stringify(result));
        return;
      }
      console.log(`Link status:      ${result.link_status}`);
      console.log(`Access status:    ${result.access_status}`);
      console.log(`Visibility:       ${formatNullable(result.visibility)}`);
      console.log(`File:             ${formatNullable(result.document_path)}`);
      console.log(`Space:            ${formatNullable(result.space_name)}`);
      console.log(`Document status:  ${result.document_status}`);
      console.log(`Role:             ${formatNullable(result.role)}`);
      console.log(`Shared by:        ${formatNullable(result.shared_by)}`);
      console.log(
        `Expires:          ${
          result.expires_at ??
          (result.access_status === 'accessible' ? 'never' : 'unknown')
        }`
      );
      console.log(`Folder:           ${formatNullable(result.is_folder)}`);
      console.log(
        `Space access:     ${formatNullable(result.has_space_access)}`
      );
    });

  share
    .command('rm')
    .description('Delete share link — docz share rm <space> <link-id>')
    .argument('<space>')
    .argument('<linkId>')
    .action(async (spaceName: string, linkId: string) => {
      const client = getClient();
      const s = await resolveSpaceArg(client, spaceName);
      await client.deleteShareLink(s.id, linkId);
      console.log(`Deleted share link: ${linkId}`);
    });

  // --- shortlink ---
  program
    .command('shortlink')
    .description('Get short URL — docz shortlink <space>:<path> or <url>')
    .argument('<target...>')
    .action(async (args: string[]) => {
      const client = getClient();
      const { spaceId, path } = await resolveTarget(client, args);
      if (!path) {
        console.error(
          'Error: file path is required. Usage: docz shortlink <space>:<path>'
        );
        process.exit(1);
      }
      const ref = await client.getFileRef(spaceId, path);
      console.log(ref.url);
    });

  // --- Univer Sheet collaboration ---
  const sheet = program
    .command('sheet')
    .description('Read and write live Univer Sheet ranges');

  sheet
    .command('get')
    .description(
      'Read a live Sheet range — docz sheet get <target> --range Sheet1!A1:B2'
    )
    .argument('<target>', 'space:path or short URL')
    .requiredOption(
      '--range <range>',
      'Absolute Sheet range, e.g. Sheet1!A1:B2'
    )
    .option('--json', 'Output machine-readable JSON')
    .option(
      '--timeout <ms>',
      'Per-phase timeout in milliseconds (max 30000)',
      Number
    )
    .action(
      async (
        target: string,
        opts: { range: string; json?: boolean; timeout?: number }
      ) => {
        const client = getClient();
        const { spaceId, path } = await resolveTarget(client, [target]);
        if (!path) throw new Error('Sheet file path is required.');
        const result = await executeSheetGet({
          client,
          baseUrl: getBaseUrl(),
          token: getRequiredToken(),
          spaceId,
          path,
          range: opts.range,
          clientVersion: __VERSION__,
          timeoutMs: opts.timeout,
        });
        printSheetResult(result, Boolean(opts.json));
        process.exitCode = sheetExitCode(result.outcome);
      }
    );

  sheet
    .command('set')
    .description(
      'Write a live Sheet range — docz sheet set <target> --range Sheet1!A1:B2 --values-json ...'
    )
    .argument('<target>', 'space:path or short URL')
    .requiredOption(
      '--range <range>',
      'Absolute Sheet range, e.g. Sheet1!A1:B2'
    )
    .requiredOption('--values-json <json>', 'Two-dimensional JSON value matrix')
    .option(
      '--request-id <uuid>',
      'Stable request id for safe command reconciliation'
    )
    .option('--json', 'Output machine-readable JSON')
    .option(
      '--timeout <ms>',
      'Per-phase timeout in milliseconds (max 30000)',
      Number
    )
    .action(
      async (
        target: string,
        opts: {
          range: string;
          valuesJson: string;
          requestId?: string;
          json?: boolean;
          timeout?: number;
        }
      ) => {
        const client = getClient();
        const { spaceId, path } = await resolveTarget(client, [target]);
        if (!path) throw new Error('Sheet file path is required.');
        const result = await executeSheetSet({
          client,
          baseUrl: getBaseUrl(),
          token: getRequiredToken(),
          spaceId,
          path,
          range: opts.range,
          valuesJson: opts.valuesJson,
          clientVersion: __VERSION__,
          timeoutMs: opts.timeout,
          requestId: opts.requestId,
        });
        printSheetResult(result, Boolean(opts.json));
        process.exitCode = sheetExitCode(result.outcome);
      }
    );

  // --- collaborative editing ---
  const collab = program
    .command('collab')
    .description('Collaborative editing via Docz realtime rooms');

  collab
    .command('cat')
    .description(
      'Read collaborative document — docz collab cat <space>:<path> or <url>'
    )
    .argument('<target>', 'space:path or short URL')
    .option('--raw', 'Output raw content only')
    .option('--timeout <ms>', 'Open timeout in milliseconds', Number)
    .action(
      async (target: string, opts: { raw?: boolean; timeout?: number }) => {
        const open = await buildCollabOpenOptions(target, {
          timeout: opts.timeout,
        });
        await withCollabRoom(open, async (room) => {
          const result = room.read();
          if (!opts.raw) {
            console.error(`collab_hash: ${result.collabHash}`);
            console.error(`read_only: ${result.readOnly ? 'true' : 'false'}`);
            console.error('---');
          }
          process.stdout.write(result.content);
        });
      }
    );

  collab
    .command('write')
    .description(
      'Write collaborative document — docz collab write <space>:<path> <content>'
    )
    .argument('<target>', 'space:path or short URL')
    .argument('<content>', 'File content (or - for stdin)')
    .option('--base-collab-hash <hash>', 'Hash returned by docz collab cat')
    .option('--force', 'Skip collaborative hash conflict detection')
    .option('--no-publish', 'Only update realtime room, do not flush to repo')
    .option('--timeout <ms>', 'Open/publish timeout in milliseconds', Number)
    .action(
      async (
        target: string,
        content: string,
        opts: {
          baseCollabHash?: string;
          force?: boolean;
          publish?: boolean;
          timeout?: number;
        }
      ) => {
        const open = await buildCollabOpenOptions(target, {
          timeout: opts.timeout,
        });
        const body = content === '-' ? await readStdin() : content;
        if (Buffer.byteLength(body, 'utf-8') > MAX_SAVE_SIZE) {
          console.error(
            'Error: content exceeds 2MB limit. Use `docz upload` for large files.'
          );
          process.exit(1);
        }

        try {
          await withCollabRoom(open, async (room) => {
            const write = room.write(body, {
              baseHash: opts.baseCollabHash,
              force: opts.force,
            });
            if (opts.publish === false) {
              console.log(
                `Updated collaborative room (collab_hash: ${write.collabHash})`
              );
              return;
            }
            const published = await room.publish(opts.timeout);
            console.log(
              `Published: ${published.path} (ref: ${published.ref}, collab_hash: ${write.collabHash})`
            );
            if (published.externalBackup) {
              console.log(`External backup: ${published.externalBackup}`);
            }
          });
        } catch (err) {
          if (err instanceof CollabConflictError) {
            console.error(
              `Error: collaborative document changed. Re-read and retry. current=${err.currentHash} base=${err.baseHash}`
            );
            process.exit(1);
          }
          if (err instanceof CollabBaseHashRequiredError) {
            console.error(
              `Error: --base-collab-hash is required unless --force is set. Re-read first to get the latest hash. current=${err.currentHash}`
            );
            process.exit(1);
          }
          if (err instanceof CollabUnknownError) {
            console.error(
              `Unknown state: ${err.message}. The server may have processed the publish; please re-read before retrying.`
            );
            process.exit(75);
          }
          throw err;
        }
      }
    );

  collab
    .command('publish')
    .description(
      'Flush collaborative document to repo — docz collab publish <space>:<path>'
    )
    .argument('<target>', 'space:path or short URL')
    .option('--timeout <ms>', 'Open/publish timeout in milliseconds', Number)
    .action(async (target: string, opts: { timeout?: number }) => {
      const open = await buildCollabOpenOptions(target, {
        timeout: opts.timeout,
      });
      try {
        await withCollabRoom(open, async (room) => {
          const result = await room.publish(opts.timeout);
          console.log(`Published: ${result.path} (ref: ${result.ref})`);
          if (result.externalBackup) {
            console.log(`External backup: ${result.externalBackup}`);
          }
        });
      } catch (err) {
        if (err instanceof CollabUnknownError) {
          console.error(
            `Unknown state: ${err.message}. The server may have processed the publish; please re-read before retrying.`
          );
          process.exit(75);
        }
        throw err;
      }
    });

  collab
    .command('bridge')
    .description('Start local JSONL bridge for terminal editors')
    .option('--client <name>', 'Client name sent to Docz', 'docz.nvim')
    .option(
      '--client-version <version>',
      'Client version sent to Docz',
      __VERSION__
    )
    .option('--timeout <ms>', 'Open/publish timeout in milliseconds', Number)
    .action(
      async (opts: {
        client: string;
        clientVersion: string;
        timeout?: number;
      }) => {
        await startCollabBridge(async (target: string) => {
          const open = await buildCollabOpenOptions(target, {
            client: opts.client,
            clientVersion: opts.clientVersion,
            timeout: opts.timeout,
          });
          const room = new CollabRoomClient();
          await room.open(open);
          return room;
        });
      }
    );

  // --- diff ---
  program
    .command('diff')
    .description(
      'Show changes — docz diff <space>[:<path>] <commit> [<from>] or <url> <commit> [<from>]'
    )
    .argument('<target>', 'space or space:path or short URL')
    .argument('<to>', 'Commit hash')
    .argument('[from]', 'From commit hash (default: to^)')
    .action(async (target: string, to: string, from?: string) => {
      const client = getClient();
      const { spaceId, path } = await resolveTarget(client, [target]);
      if (path) {
        const result = await client.diffFile(spaceId, path, to, from);
        if (result.diff) {
          process.stdout.write(result.diff);
        } else {
          console.log('No changes.');
        }
      } else {
        const result = await client.diffSummary(spaceId, to, from);
        if (result.files.length === 0) {
          console.log('No changes.');
          return;
        }
        for (const f of result.files) {
          console.log(`${f.status}  ${f.path}`);
        }
      }
    });
}
