import { CollabError } from './types.js';

// Never echo arbitrary server bodies, close reasons, or transport errors: they
// can contain bearer tokens, proxy HTML, and request details.
const codes = new Set([
  'forbidden',
  'unauthorized',
  'read_only',
  'reload_for_file_identity',
  'legacy_room_active',
  'identity_unavailable',
  'identity_changed',
  'identity_or_permission_changed',
  'identity_or_session_changed',
  'operation_identity_mismatch',
  'capability_disabled',
  'session_unavailable',
  'session_expired',
  'file_unavailable',
  'file_missing',
  'external_deleted',
  'content_too_large',
  'content_changed',
  'document_temporarily_unavailable',
  'transport_unconfirmed',
  'response_unconfirmed',
  'unclassified',
  'invalid_response',
  'pending_operation',
  'storage_unconfirmed',
  'storage_rejected',
  'storage_receipt_unconfirmed',
  'prepare_failed',
  'prepare_unconfirmed',
  'metadata_commit_unconfirmed',
  'metadata_fence_failed',
  'metadata_unavailable',
  'identity_read_failed',
  'identity_update_failed',
  'completion_record_failed',
  'rejection_record_unconfirmed',
  'coordination_unavailable',
  'snapshot_unavailable',
  'commit_read_failed',
  'actor_unavailable',
  'author_update_failed',
  'invalid_operation_id',
  'operation_lookup_failed',
  'operation_missing',
  'operation_not_observed',
  'awaiting_storage_confirmation',
]);

export function safeCollabCode(value: unknown): string | undefined {
  return typeof value === 'string' &&
    (codes.has(value) || /^(?:identity_)?http_[45]\d\d$/.test(value))
    ? value
    : undefined;
}

export function collabHTTPError(status: number, code?: unknown): CollabError {
  const safe = safeCollabCode(code);
  const category =
    status === 401 || status === 403
      ? 'permission_denied'
      : status === 409
        ? 'identity_conflict'
        : status >= 500 || status === 429
          ? 'service_unavailable'
          : 'session_rejected';
  return new CollabError(
    safe ?? category,
    `collab ${category} (HTTP ${status}${safe ? `, ${safe}` : ''})`
  );
}

export function collabAuthError(reason: unknown): CollabError {
  if (reason === 'permission-denied') {
    return new CollabError(
      'authentication_rejected',
      'collab authentication rejected (permission-denied); server did not disclose whether this is permission, identity, or service failure'
    );
  }
  const code = safeCollabCode(reason);
  return new CollabError(
    code ?? 'authentication_rejected',
    `collab authentication rejected${code ? `: ${code}` : '; server reason unavailable'}`
  );
}
