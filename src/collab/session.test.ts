import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveCollabSession } from './session.js';
import type { CollabOpenOptions } from './types.js';

const options: CollabOpenOptions = {
  baseUrl: 'https://example.invalid',
  token: 'FAKE-secret-do-not-log',
  spaceId: 'space',
  path: 'old.md',
  client: 'test',
  clientVersion: 'test',
  timeoutMs: 100,
};
const session = {
  enabled: true,
  file_id: 'file-id',
  file_path: 'renamed.md',
  identity_version: 2,
  read_only: false,
};
afterEach(() => vi.unstubAllGlobals());
function reply(body: unknown, status = 200) {
  return vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
      })
    )
  );
}

describe('collab session negotiation', () => {
  it('sends stable reference and follows canonical renamed identity', async () => {
    reply(session);
    expect(
      await resolveCollabSession({ ...options, fileId: 'alias' })
    ).toMatchObject({
      fileId: 'file-id',
      path: 'renamed.md',
      identityVersion: 2,
      readOnly: false,
    });
    const init = vi.mocked(fetch).mock.calls[0][1];
    if (!init) throw new Error('test request missing');
    expect(JSON.parse(String(init.body))).toEqual({
      space_id: 'space',
      path: 'old.md',
      file_id: 'alias',
    });
    expect(init.redirect).toBe('error');
  });
  it('retains read-only session authorization', async () => {
    reply({ ...session, read_only: true });
    expect(await resolveCollabSession(options)).toMatchObject({
      readOnly: true,
    });
  });
  it.each(['old.md', 'notes.txt', 'page.html', 'data.csv'])(
    'uses legacy rooms when disabled for %s',
    async (path) => {
      reply({ enabled: false });
      expect(
        await resolveCollabSession({ ...options, path, fileId: 'file-id' })
      ).toMatchObject({ fileId: undefined, path });
    }
  );
  it('supports the Go missing endpoint response on old deployments', async () => {
    reply('404 page not found\n', 404);
    expect(await resolveCollabSession(options)).toMatchObject({
      fileId: undefined,
    });
  });
  it.each([
    [409, 'legacy_room_active'],
    [409, 'identity_unavailable'],
    [404, 'file_unavailable'],
    [403, 'forbidden'],
    [401, 'unauthorized'],
    [503, 'session_unavailable'],
  ])('does not downgrade HTTP %s %s', async (status, code) => {
    reply({ code, error_message: options.token }, status as number);
    await expect(resolveCollabSession(options)).rejects.toMatchObject({ code });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    null,
    {},
    { enabled: true },
    { ...session, read_only: undefined },
    { ...session, identity_version: '2' },
    { ...session, file_id: 'bad:id' },
  ])('rejects malformed session without fallback: %j', async (body) => {
    reply(body);
    await expect(resolveCollabSession(options)).rejects.toMatchObject({
      code: 'session_invalid',
    });
  });
  it.each(['workbook.sheet.json', 'image.png', 'diagram.excalidraw.json'])(
    'rejects non-text collaboration models: %s',
    async (path) => {
      reply(session);
      await expect(
        resolveCollabSession({ ...options, path })
      ).rejects.toMatchObject({ code: 'unsupported_document' });
      expect(fetch).not.toHaveBeenCalled();
    }
  );
  it.each([0, -1, NaN, Infinity, 1.5, 300001])(
    'rejects invalid timeout %s before HTTP',
    async (timeoutMs) => {
      reply(session);
      await expect(
        resolveCollabSession({ ...options, timeoutMs })
      ).rejects.toMatchObject({ code: 'invalid_timeout' });
      expect(fetch).not.toHaveBeenCalled();
    }
  );
  it('bounds a hung request including response body consumption', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () =>
              reject(init.signal.reason)
            );
          })
      )
    );
    await expect(
      resolveCollabSession({ ...options, timeoutMs: 10 })
    ).rejects.toMatchObject({ code: 'session_timeout' });
  });
  it('never leaks response bodies or network errors', async () => {
    reply({ code: options.token, error: options.token }, 409);
    let error = await resolveCollabSession(options).catch((e) => e);
    expect(String(error)).not.toContain(options.token);
    expect(error.code).toBe('identity_conflict');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(options.token)));
    error = await resolveCollabSession(options).catch((e) => e);
    expect(String(error)).not.toContain(options.token);
    expect(error.code).toBe('service_unavailable');
  });
});
