import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DocSyncClient } from './client.js';

const BASE = 'https://docz.test.com';
const TOKEN = 'test-token';
const SID = 'space-abc';

const mockSpaces = [
  {
    id: SID,
    name: '研发',
    owner_id: 'u1',
    is_private: false,
    created_at: '2026-03-24T09:00:00Z',
    member_count: 50,
  },
  {
    id: 'space-priv',
    name: '吴鹏飞',
    owner_id: 'u2',
    is_private: true,
    created_at: '2026-03-27T09:00:00Z',
    member_count: 1,
  },
];

const mockTree = [
  { name: 'README.md', type: 'blob', size: 1024 },
  { name: 'docs', type: 'tree', size: 0 },
];

const mockLog = [
  {
    hash: 'abc1234',
    author: 'docsync@localhost',
    message: 'web: upload README.md',
    date: '2026-03-27T10:00:00+08:00',
    num_files: 1,
  },
];

const server = setupServer(
  http.get(`${BASE}/api/auth/me`, ({ request }) => {
    if (!request.headers.get('Authorization')?.includes(TOKEN)) {
      return HttpResponse.text('invalid token', { status: 401 });
    }
    return HttpResponse.json({
      id: 'u1',
      email: 'test@kanyun.com',
      name: '测试用户',
      is_admin: false,
      is_active: true,
      created_at: '2026-03-27T09:00:00Z',
    });
  }),

  http.get(`${BASE}/api/spaces`, () => HttpResponse.json(mockSpaces)),

  http.get(`${BASE}/api/spaces/:sid/tree`, () => HttpResponse.json(mockTree)),

  http.get(`${BASE}/api/spaces/:sid/blob/:fp`, ({ params }) => {
    if (params.fp === 'README.md') {
      return HttpResponse.text('# Hello\nTest file.');
    }
    return HttpResponse.text('not found', { status: 404 });
  }),

  http.post(`${BASE}/api/spaces/:sid/files/upload`, async ({ request }) => {
    const form = await request.formData();
    const path = form.get('path') as string;
    const file = form.get('file') as File;
    return HttpResponse.json({ path: `${path}/${file.name}` });
  }),

  http.post(`${BASE}/api/spaces/:sid/files/mkdir`, () => HttpResponse.json({})),

  http.post(`${BASE}/api/spaces/:sid/files/delete`, () =>
    HttpResponse.text('')
  ),

  http.post(`${BASE}/api/spaces/:sid/files/rename`, async ({ request }) => {
    const body = (await request.json()) as Record<string, string>;
    return HttpResponse.json(body);
  }),

  http.get(`${BASE}/api/spaces/:sid/log/`, () => HttpResponse.json(mockLog)),

  http.get(`${BASE}/api/spaces/:sid/log/:fp`, () => HttpResponse.json(mockLog)),

  http.get(`${BASE}/api/spaces/:sid/trash`, () => HttpResponse.json([]))
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('DocSyncClient', () => {
  const c = new DocSyncClient(BASE, TOKEN);

  it('me() returns user', async () => {
    const u = await c.me();
    expect(u.name).toBe('测试用户');
  });

  it('listSpaces() returns spaces', async () => {
    const s = await c.listSpaces();
    expect(s).toHaveLength(2);
  });

  it('resolveSpace() by name', async () => {
    const s = await c.resolveSpace('研发');
    expect(s.id).toBe(SID);
  });

  it('resolveSpace() by id', async () => {
    const s = await c.resolveSpace(SID);
    expect(s.id).toBe(SID);
  });

  it('resolveSpace() throws on unknown', async () => {
    await expect(c.resolveSpace('nope')).rejects.toThrow('not found');
  });

  it('ls() returns entries', async () => {
    const entries = await c.ls(SID);
    expect(entries).toHaveLength(2);
    expect(entries[0].name).toBe('README.md');
  });

  it('cat() returns content', async () => {
    const txt = await c.cat(SID, 'README.md');
    expect(txt).toContain('# Hello');
  });

  it('cat() throws on 404', async () => {
    await expect(c.cat(SID, 'nope.md')).rejects.toThrow('404');
  });

  it('upload() returns path', async () => {
    const r = await c.upload(SID, 'docs', 'test.md', '# Test');
    expect(r.path).toBe('docs/test.md');
  });

  it('mkdir() succeeds', async () => {
    await expect(c.mkdir(SID, 'new')).resolves.not.toThrow();
  });

  it('rm() succeeds', async () => {
    await expect(c.rm(SID, 'old.md')).resolves.not.toThrow();
  });

  it('mv() succeeds', async () => {
    await expect(c.mv(SID, 'a.md', 'b.md')).resolves.not.toThrow();
  });

  it('log() returns entries', async () => {
    const logs = await c.log(SID);
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toContain('upload');
  });

  it('log() with filepath', async () => {
    const logs = await c.log(SID, 'README.md');
    expect(logs).toHaveLength(1);
  });

  it('trash() returns empty', async () => {
    const t = await c.trash(SID);
    expect(t).toHaveLength(0);
  });

  it('rejects with 401 on bad token', async () => {
    const bad = new DocSyncClient(BASE, 'bad');
    await expect(bad.me()).rejects.toThrow('401');
  });
});
