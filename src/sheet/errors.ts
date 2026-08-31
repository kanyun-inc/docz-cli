export type SheetFailureCode =
  | 'authentication_required'
  | 'sheet_arguments_invalid'
  | 'sheet_target_invalid'
  | 'sheet_path_required'
  | 'sheet_timeout_invalid'
  | 'collaboration_timeout'
  | 'collaboration_unavailable'
  | 'collaboration_permission_denied'
  | 'collaboration_conflict'
  | 'sheet_read_failed'
  | 'sheet_worksheet_not_found'
  | 'sheet_range_invalid'
  | 'sheet_write_command_rejected'
  | 'sheet_write_invalid_values'
  | 'sheet_write_sdk_incompatible'
  | 'sheet_write_command_failed'
  | 'initial_load_failed'
  | 'sheet_write_forbidden'
  | 'operation_begin_unconfirmed'
  | 'sheet_identity_changed'
  | 'operation_execution_not_claimed'
  | 'interrupted_after_mutation'
  | 'interrupted_before_mutation'
  // Operation codes accepted and returned by the server for typed inbound
  // responses. The current CLI does not emit them when finalizing an operation.
  | 'pending_timeout'
  | 'sync_confirmation_lost'
  | 'sdk_rejected';

/**
 * Convert an untrusted SDK/network error to a bounded diagnostic code. The
 * original message is inspected only in memory and must never be returned or
 * logged because upstream errors can contain URLs or credentials.
 */
export function classifySheetFailure(
  error: unknown,
  fallback: SheetFailureCode
): SheetFailureCode {
  const name = error instanceof Error ? error.name : '';
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  const signature = `${name} ${message}`.toLowerCase();

  if (/timeout|timed out|aborterror/.test(signature)) {
    return 'collaboration_timeout';
  }
  if (/forbidden|unauthori[sz]ed|permission|\b401\b|\b403\b/.test(signature)) {
    return 'collaboration_permission_denied';
  }
  if (/conflict/.test(signature)) {
    return 'collaboration_conflict';
  }
  if (/worksheet.+not found/.test(signature)) {
    return 'sheet_worksheet_not_found';
  }
  if (/invalid.+range|range.+invalid/.test(signature)) {
    return 'sheet_range_invalid';
  }
  if (
    /offline|network|fetch failed|econn|socket|websocket|connection/.test(
      signature
    )
  ) {
    return 'collaboration_unavailable';
  }
  return fallback;
}

export function classifySheetWriteFailure(error: unknown): SheetFailureCode {
  if (error === false) return 'sheet_write_command_rejected';
  const name = error instanceof Error ? error.name : '';
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  const signature = `${name} ${message}`.toLowerCase();
  if (/rejected the sheet write command/.test(signature)) {
    return 'sheet_write_command_rejected';
  }
  if (/invalid value|matrix|dimension|range size/.test(signature)) {
    return 'sheet_write_invalid_values';
  }
  if (
    /not a function|cannot read|cannot destructure|undefined|null/.test(
      signature
    )
  ) {
    return 'sheet_write_sdk_incompatible';
  }
  if (/not registered|registration/.test(signature)) {
    return 'sheet_write_sdk_incompatible';
  }
  const collaborationFailure = classifySheetFailure(
    error,
    'sheet_write_command_failed'
  );
  return collaborationFailure === 'sheet_write_command_failed'
    ? 'sheet_write_command_failed'
    : collaborationFailure;
}
