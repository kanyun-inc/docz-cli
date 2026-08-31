import type { SheetFailureCode } from './errors.js';

export type SheetOutcome = 'SYNCED' | 'FAILED' | 'UNKNOWN';

export interface SheetSession {
  space_id: string;
  path: string;
  file_ref_id: string;
  unit_id: string;
  // Univer role mapped from the Docz Space role:
  // owner -> owner, member -> editor, viewer -> reader.
  role: 'owner' | 'editor' | 'reader';
  can_read: boolean;
  can_write: boolean;
  univer_endpoint: string;
  descriptor_version: number;
}

export interface SheetOperation {
  id: string;
  request_id: string;
  user_id: string;
  space_id: string;
  file_ref_id: string;
  file_path: string;
  unit_id: string;
  range?: string;
  client_type: string;
  client_version: string;
  operation: 'set';
  outcome: 'PENDING' | SheetOutcome;
  execution_allowed?: boolean;
  last_collaboration_status?: string;
  failure_code?: SheetFailureCode;
  start_revision?: number;
  end_revision?: number;
  revision_verified?: boolean;
  deadline_at: string;
}

export interface SheetCommandResult {
  outcome: SheetOutcome;
  phase: 'load' | 'read' | 'write' | 'confirm';
  space_id: string;
  path: string;
  unit_id: string;
  collaboration_status: string;
  request_id?: string;
  operation_id?: string;
  range: string | null;
  requested_range?: string;
  range_verified?: false;
  values?: unknown[][];
  failure_code?: SheetFailureCode;
  warning?: string;
}

/**
 * A stable machine result for failures before a canonical Sheet session is
 * available. No Univer mutation can have been sent in this phase, so the
 * outcome is always the definite FAILED state. Empty space/path values mean
 * target resolution did not complete; unit_id is null until Docz has resolved
 * the canonical Sheet identity.
 */
export interface SheetPreflightFailureResult {
  outcome: 'FAILED';
  phase: 'validate' | 'load';
  space_id: string;
  path: string;
  unit_id: null;
  identity_resolved: false;
  collaboration_status: 'NOT_STARTED';
  request_id?: string;
  operation_id?: never;
  range: string;
  values?: never;
  failure_code: SheetFailureCode;
  warning?: string;
}

export type SheetCLIResult = SheetCommandResult | SheetPreflightFailureResult;

export interface OpenSheetOptions {
  session: SheetSession;
  doczBaseUrl: string;
  token: string;
  clientVersion: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface OpenUniverSheet {
  read(sheetName: string, a1: string): unknown[][];
  write(
    sheetName: string,
    a1: string,
    values: unknown[][],
    onMutationMayHaveBeenSent?: () => void
  ): void | Promise<void>;
  status(): string;
  revision(): number;
  waitForInitialSync(timeoutMs?: number): Promise<string>;
  waitForWriteSync(
    timeoutMs?: number,
    mutationStarted?: () => boolean,
    mutationApplied?: () => boolean
  ): Promise<string>;
  dispose(): Promise<void>;
}

export type SheetOpener = (
  options: OpenSheetOptions
) => Promise<OpenUniverSheet>;
