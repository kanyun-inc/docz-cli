import { Hocuspocus } from '@hocuspocus/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { runCLI } from '../cli.js';
import { CollabRoomClient } from './room.js';
import { collabHash } from './text.js';
import { type CollabOpenOptions, CollabUnknownError } from './types.js';

let server: Hocuspocus;
let options: CollabOpenOptions;
let rooms: CollabRoomClient[];
let mode: string;
let requests: Array<{ name: string; params: URLSearchParams }>;
let publishes: number;
const secret = 'FAKE-bearer-never-log';
const oldExit = process.exitCode;

beforeEach(async () => {
  rooms = [];
  requests = [];
  publishes = 0;
  mode = 'success';
  Reflect.set(globalThis, '__VERSION__', 'test');
  server = new Hocuspocus({
    port: 0,
    address: '127.0.0.1',
    quiet: true,
    stopOnSignals: false,
    async onAuthenticate(data) {
      requests.push({
        name: data.documentName,
        params: data.requestParameters,
      });
      if (mode === 'auth') throw { reason: 'permission-denied' };
      if (mode === 'secret-auth') throw { reason: secret };
      if (mode === 'migration') throw { reason: 'reload_for_file_identity' };
      if (mode === 'readonly') data.connection.readOnly = true;
      return {};
    },
    async onLoadDocument(data) {
      if (mode === 'load-timeout')
        await new Promise((resolve) => setTimeout(resolve, 120));
      data.document.getText('content').insert(0, 'browser unsaved text');
      return data.document;
    },
    async onStateless(data) {
      const msg = JSON.parse(data.payload);
      if (msg.type !== 'publish') return;
      publishes++;
      expect(msg.operationId).toBe(msg.reqId);
      if (mode === 'timeout') return;
      if (mode === 'disconnect') {
        data.connection.close();
        return;
      }
      if (mode === 'unknown') {
        data.connection.sendStateless(
          JSON.stringify({
            type: 'publish_error',
            reqId: msg.reqId,
            outcome: 'unknown',
            code: 'storage_unconfirmed',
          })
        );
        return;
      }
      if (mode === 'failure' || mode === 'secret-failure') {
        data.connection.sendStateless(
          JSON.stringify({
            type: 'publish_error',
            reqId: msg.reqId,
            outcome: 'failure',
            code: mode === 'failure' ? 'identity_changed' : secret,
          })
        );
        return;
      }
      if (mode === 'legacy-error') {
        data.connection.sendStateless(
          JSON.stringify({ type: 'publish_error', reqId: msg.reqId })
        );
        return;
      }
      if (mode === 'bad-ack') {
        data.connection.sendStateless(
          JSON.stringify({ type: 'publish_ack', reqId: msg.reqId })
        );
        return;
      }
      data.connection.sendStateless(
        JSON.stringify({ type: 'notice', reqId: msg.reqId })
      );
      data.connection.sendStateless(
        JSON.stringify({
          type: 'publish_ack',
          reqId: msg.reqId,
          ref: 'commit-1',
          content_ref: 'blob-1',
        })
      );
    },
  });
  await server.listen();
  options = {
    baseUrl: server.httpURL,
    token: secret,
    spaceId: 'space',
    path: 'original.md',
    fileId: 'file-id',
    identityVersion: 1,
    client: 'test',
    clientVersion: 'test',
    timeoutMs: 1000,
  };
});
afterEach(async () => {
  for (const room of rooms) room.close();
  await server.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  Reflect.deleteProperty(globalThis, '__VERSION__');
  process.exitCode = oldExit;
});
async function open(extra: Partial<CollabOpenOptions> = {}) {
  const room = new CollabRoomClient();
  rooms.push(room);
  await room.open({ ...options, ...extra });
  return room;
}

describe('real WebSocket collab lifecycle', () => {
  it('joins a file ID room, reads unpersisted browser text and publishes', async () => {
    const room = await open();
    expect(requests[0].name).toBe('v2:space:file-id');
    expect(requests[0].params.get('file_id')).toBe('file-id');
    expect(requests[0].params.has('token')).toBe(false);
    expect(room.read().content).toBe('browser unsaved text');
    room.write('edited', { baseHash: room.read().collabHash });
    await expect(room.publish()).resolves.toMatchObject({ ref: 'commit-1' });
    expect(
      server.documents.get('v2:space:file-id')?.getText('content').toString()
    ).toBe('edited');
    room.close();
    expect(room.read().connected).toBe(false);
  });
  it('connects to a legacy text room', async () => {
    await open({ fileId: undefined, path: 'notes.txt' });
    expect(requests[0].name).toBe('space:notes.txt');
  });
  it.each([true, false])(
    'blocks read-only writes and publish (session readOnly=%s)',
    async (sessionReadOnly) => {
      if (!sessionReadOnly) mode = 'readonly';
      const room = await open({ readOnly: sessionReadOnly });
      expect(room.read().readOnly).toBe(true);
      expect(() => room.write('bad', { force: true })).toThrow('read-only');
      await expect(room.publish()).rejects.toThrow('read-only');
      expect(publishes).toBe(0);
    }
  );
  it('rejects stale hashes after a concurrent browser edit without overwriting it', async () => {
    const cli = await open();
    const browser = await open();
    const hash = cli.read().collabHash;
    browser.doc.getText('content').insert(0, 'concurrent ');
    await vi.waitFor(() =>
      expect(cli.read().content).toBe('concurrent browser unsaved text')
    );
    expect(() => cli.write('overwrite', { baseHash: hash })).toThrow(
      'changed since'
    );
    expect(cli.read().content).toBe(browser.read().content);
  });
  it('preserves concurrent Yjs insertions even when they arrive after local replacement', async () => {
    const room = await open();
    const offline = new Y.Doc();
    Y.applyUpdate(offline, Y.encodeStateAsUpdate(room.doc));
    const baseline = Y.encodeStateVector(offline);
    offline.getText('content').insert(0, 'parallel ');
    room.write('CLI edit', { baseHash: room.read().collabHash });
    Y.applyUpdate(room.doc, Y.encodeStateAsUpdate(offline, baseline));
    expect(room.read().content).toContain('parallel ');
    expect(room.read().content).toContain('CLI edit');
    offline.destroy();
  });
  it('confirms --no-publish updates before closing', async () => {
    const room = await open();
    room.write('realtime only', { baseHash: room.read().collabHash });
    await room.confirmChanges();
    expect(
      server.documents.get('v2:space:file-id')?.getText('content').toString()
    ).toBe('realtime only');
    expect(publishes).toBe(0);
  });
  it('tracks rename broadcasts and refuses a mismatched identity', async () => {
    const room = await open();
    const doc = server.documents.get('v2:space:file-id');
    if (!doc) throw new Error('test room missing');
    doc.broadcastStateless(
      JSON.stringify({
        type: 'file_identity',
        space_id: 'space',
        file_id: 'file-id',
        file_path: 'renamed.md',
        identity_version: 2,
      })
    );
    await vi.waitFor(() => expect(room.read().path).toBe('renamed.md'));
    doc.broadcastStateless(
      JSON.stringify({
        type: 'file_identity',
        space_id: 'space',
        file_id: 'another',
        file_path: 'bad.md',
        identity_version: 3,
      })
    );
    await vi.waitFor(() => expect(room.read().connected).toBe(false));
    expect(() => room.write('bad', { force: true })).toThrow(
      'identity mismatch'
    );
  });
  it('does not recreate a deleted file', async () => {
    const room = await open();
    server.documents
      .get('v2:space:file-id')
      ?.broadcastStateless(JSON.stringify({ type: 'external_deleted' }));
    await vi.waitFor(() => expect(room.read().connected).toBe(false));
    await expect(room.publish()).rejects.toThrow('deleted');
    expect(publishes).toBe(0);
  });
  it.each(['unknown', 'timeout', 'disconnect', 'legacy-error', 'bad-ack'])(
    'classifies %s as unknown and never replays publish',
    async (kind) => {
      mode = kind;
      const room = await open();
      await expect(room.publish(60)).rejects.toBeInstanceOf(CollabUnknownError);
      expect(publishes).toBe(1);
      expect(requests).toHaveLength(1);
      await expect(room.publish()).rejects.toBeInstanceOf(CollabUnknownError);
      expect(publishes).toBe(1);
    }
  );
  it('keeps explicit identity conflict as a definite rejection', async () => {
    mode = 'failure';
    const room = await open();
    await expect(room.publish()).rejects.toMatchObject({
      code: 'identity_changed',
    });
  });
  it.each(['auth', 'secret-auth', 'migration', 'load-timeout'])(
    'cleans up a failed open: %s',
    async (kind) => {
      mode = kind;
      const room = new CollabRoomClient();
      rooms.push(room);
      const error = await room
        .open({ ...options, timeoutMs: 50 })
        .catch((e) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(CollabUnknownError);
      expect(String(error)).not.toContain(secret);
      if (kind === 'auth')
        expect(String(error)).toContain('server did not disclose');
      if (kind === 'migration')
        expect(error.code).toBe('reload_for_file_identity');
      expect(room.read().connected).toBe(false);
    }
  );
  it('closing during publish rejects it as unknown and forbids reuse', async () => {
    mode = 'timeout';
    const room = await open();
    const result = room.publish();
    const check = expect(result).rejects.toBeInstanceOf(CollabUnknownError);
    room.close();
    await check;
    await expect(room.open(options)).rejects.toThrow('new collab client');
  });
  it('closing before initial sync promptly rejects open and cleans up', async () => {
    mode = 'load-timeout';
    const room = new CollabRoomClient();
    rooms.push(room);
    const result = room.open(options);
    const check = expect(result).rejects.toMatchObject({ code: 'room_closed' });
    room.close();
    await check;
    expect(room.read().connected).toBe(false);
  });
});

describe('CLI exit status and safe diagnostics', () => {
  it.each([
    ['unknown', 75],
    ['failure', 1],
    ['secret-failure', 1],
    ['auth', 1],
    ['success', undefined],
  ])('%s returns %s without leaking credentials', async (kind, exitCode) => {
    mode = kind as string;
    process.exitCode = undefined;
    vi.stubEnv('DOCSYNC_API_TOKEN', secret);
    vi.stubEnv('DOCSYNC_BASE_URL', server.httpURL);
    const payloads = [
      [{ id: 'space', slug: 'tech' }],
      { id: 'file-id', space_id: 'space', path: 'old.md', is_dir: false },
      {
        enabled: true,
        file_id: 'file-id',
        file_path: 'renamed.md',
        identity_version: 2,
        read_only: false,
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        async () =>
          new Response(JSON.stringify(payloads.shift()), {
            headers: { 'Content-Type': 'application/json' },
          })
      )
    );
    const logs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });
    vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });
    await runCLI(
      [
        'collab',
        'write',
        `${server.httpURL}/s/tech/f/file-id`,
        'CLI edit',
        '--base-collab-hash',
        collabHash('browser unsaved text'),
        '--timeout',
        '1000',
      ],
      'test'
    );
    expect(process.exitCode).toBe(exitCode);
    expect(logs.join('\n')).not.toContain(secret);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(publishes).toBe(kind === 'auth' ? 0 : 1);
  });
});
