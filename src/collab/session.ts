import { collabHTTPError } from './errors.js';
import { CollabError, type CollabOpenOptions } from './types.js';

export function collabTimeout(value = 30000): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 300000) {
    throw new CollabError(
      'invalid_timeout',
      'collab timeout must be an integer between 1 and 300000ms'
    );
  }
  return value;
}

export function assertTextTarget(path: string): void {
  // These formats have separate collaboration models; never edit descriptors.
  if (
    !/\.(md|txt|csv|html?|json|ya?ml|xml|svg|css|js|ts|tsx|jsx|log)$/i.test(
      path
    ) ||
    /\.(sheet|excalidraw|drawio)\.json$/i.test(path)
  ) {
    throw new CollabError(
      'unsupported_document',
      'collab supports text documents only; use sheet commands for Univer sheets'
    );
  }
}

/** Resolve identity before joining a room. Only an absent endpoint may fall
 * back to the legacy protocol; a document-specific 404/409 must fail closed. */
export async function resolveCollabSession(
  options: CollabOpenOptions
): Promise<CollabOpenOptions> {
  assertTextTarget(options.path);
  const timeoutMs = collabTimeout(options.timeoutMs);
  let response: Response;
  let body: string;
  try {
    response = await fetch(
      `${options.baseUrl.replace(/\/$/, '')}/api/collab/session`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          space_id: options.spaceId,
          path: options.path,
          file_id: options.fileId,
        }),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      }
    );
    body = await response.text();
  } catch (err) {
    const timeout =
      err instanceof Error && ['TimeoutError', 'AbortError'].includes(err.name);
    throw new CollabError(
      timeout ? 'session_timeout' : 'service_unavailable',
      timeout
        ? 'collab session timed out before room connection'
        : 'collab session service unavailable'
    );
  }
  const legacy = {
    ...options,
    fileId: undefined,
    identityVersion: undefined,
    timeoutMs,
  };
  // Go net/http's missing-route response. Do not confuse file_unavailable with
  // an old deployment or downgrade on authentication / transport failures.
  if (response.status === 404 && body.trim() === '404 page not found')
    return legacy;
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error();
    data = parsed as Record<string, unknown>;
  } catch {
    if (!response.ok) throw collabHTTPError(response.status);
    throw new CollabError('session_invalid', 'collab session response invalid');
  }
  if (!response.ok) throw collabHTTPError(response.status, data.code);
  if (data.enabled === false) return legacy;
  if (
    data.enabled !== true ||
    typeof data.file_id !== 'string' ||
    !/^[a-zA-Z0-9_-]+$/.test(data.file_id) ||
    typeof data.file_path !== 'string' ||
    !data.file_path ||
    !Number.isSafeInteger(data.identity_version) ||
    (data.identity_version as number) < 1 ||
    typeof data.read_only !== 'boolean'
  ) {
    throw new CollabError('session_invalid', 'collab session response invalid');
  }
  assertTextTarget(data.file_path);
  return {
    ...options,
    timeoutMs,
    fileId: data.file_id,
    path: data.file_path,
    identityVersion: data.identity_version as number,
    readOnly: data.read_only,
  };
}
