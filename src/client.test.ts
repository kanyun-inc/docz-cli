import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ConflictError, DocSyncClient } from './client.js';

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

const mockShareLink = {
  id: 'link-001',
  token: 'xYz123AbC',
  space_id: SID,
  file_path: 'README.md',
  created_by: 'u1',
  creator_name: '测试用户',
  expires_at: null,
  created_at: '2026-04-17T10:00:00Z',
  user_ids: [],
  group_ids: [],
};

const mockShareFileInfo = {
  file_path: 'README.md',
  file_name: 'README.md',
  space_name: '研发',
  created_by_name: '测试用户',
  expires_at: null,
};

const mockDiffResponse = {
  from: 'aaa1111',
  to: 'bbb2222',
  path: 'README.md',
  diff: '--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-# Hello\n+# Hello World',
  old_body: '# Hello',
  new_body: '# Hello World',
};

const mockDiffSummary = {
  from: 'aaa1111',
  to: 'bbb2222',
  files: [
    { path: 'README.md', status: 'M' },
    { path: 'new.md', status: 'A' },
  ],
};

const mockFileRef = { id: 'NNjrcj8c', space_id: SID, path: 'README.md' };

const HEAD_REF = 'deadbeef1234567890abcdef1234567890abcdef';
const NEW_REF = 'cafebabe1234567890abcdef1234567890abcdef';

const mockComment = {
  id: 42,
  space_id: SID,
  file_path: 'README.md',
  comment_type: 'text',
  target_type: 'selection',
  target_selector: '',
  target_content: '',
  content: '需要补充说明',
  user_id: 'u1',
  user_name: '测试用户',
  user_email: 'test@kanyun.com',
  is_closed: false,
  created_at: '2026-04-24T10:00:00Z',
  updated_at: '2026-04-24T10:00:00Z',
  replies: [
    {
      id: 101,
      comment_id: 42,
      content: '已补充',
      user_id: 'u2',
      user_name: '吴鹏飞',
      user_email: 'wupf@kanyun.com',
      created_at: '2026-04-24T11:00:00Z',
      updated_at: '2026-04-24T11:00:00Z',
    },
  ],
};

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

  http.get(`${BASE}/api/spaces/:sid/tree/full`, () =>
    HttpResponse.json([
      ...mockTree,
      { name: 'docs/guide.md', type: 'blob', size: 512 },
    ])
  ),

  http.get(`${BASE}/api/spaces/:sid/blob/:fp`, ({ params }) => {
    if (params.fp === 'README.md') {
      return new HttpResponse('# Hello\nTest file.', {
        headers: {
          'Content-Type': 'text/plain',
          'X-Git-Ref': HEAD_REF,
        },
      });
    }
    return HttpResponse.text('not found', { status: 404 });
  }),

  http.post(`${BASE}/api/spaces/:sid/files/upload`, async ({ request }) => {
    const form = await request.formData();
    const path = form.get('path') as string;
    const file = form.get('file') as File;
    return HttpResponse.json({ path: `${path}/${file.name}` });
  }),

  http.post(`${BASE}/api/spaces/:sid/files/save`, async ({ request }) => {
    const body = (await request.json()) as Record<string, string>;
    if (body.base_ref === 'stale-ref') {
      return HttpResponse.json(
        {
          error: 'conflict',
          current_ref: HEAD_REF,
          path: body.path,
        },
        { status: 409 }
      );
    }
    return HttpResponse.json({ path: body.path, ref: NEW_REF });
  }),

  http.post(`${BASE}/api/spaces/:sid/files/mkdir`, () => HttpResponse.json({})),

  http.post(`${BASE}/api/spaces/:sid/files/delete`, () =>
    HttpResponse.text('')
  ),

  http.post(`${BASE}/api/spaces/:sid/files/rename`, async ({ request }) => {
    const body = (await request.json()) as Record<string, string>;
    return HttpResponse.json(body);
  }),

  http.post(`${BASE}/api/spaces/:sid/files/rollback`, async ({ request }) => {
    const body = (await request.json()) as Record<string, string>;
    return HttpResponse.json({
      file_path: body.file_path,
      commit_hash: body.commit_hash,
    });
  }),

  http.get(`${BASE}/api/spaces/:sid/log/`, () => HttpResponse.json(mockLog)),

  http.get(`${BASE}/api/spaces/:sid/log/:fp`, () => HttpResponse.json(mockLog)),

  http.get(`${BASE}/api/spaces/:sid/trash`, () =>
    HttpResponse.json([
      {
        path: 'deleted.md',
        deleted_by: 'u1',
        deleted_at: '2026-04-24T09:00:00Z',
        commit: 'del1234',
      },
    ])
  ),

  http.post(`${BASE}/api/spaces/:sid/trash/restore`, async ({ request }) => {
    const body = (await request.json()) as Record<string, string>;
    return HttpResponse.json({ path: body.path, commit: body.commit });
  }),

  // --- Comments ---
  http.get(`${BASE}/api/spaces/:sid/comments`, () =>
    HttpResponse.json([mockComment])
  ),

  http.post(`${BASE}/api/spaces/:sid/comments`, async ({ request }) => {
    const body = (await request.json()) as Record<string, string>;
    return HttpResponse.json(
      {
        ...mockComment,
        id: 43,
        file_path: body.file_path,
        content: body.content,
        replies: [],
      },
      { status: 201 }
    );
  }),

  http.put(
    `${BASE}/api/spaces/:sid/comments/:commentId`,
    async ({ params }) => {
      return HttpResponse.json({
        ...mockComment,
        id: Number(params.commentId),
        is_closed: true,
      });
    }
  ),

  http.delete(
    `${BASE}/api/spaces/:sid/comments/:commentId`,
    () => new HttpResponse(null, { status: 204 })
  ),

  http.post(
    `${BASE}/api/spaces/:sid/comments/:commentId/replies`,
    async ({ request, params }) => {
      const body = (await request.json()) as Record<string, string>;
      return HttpResponse.json(
        {
          id: 102,
          comment_id: Number(params.commentId),
          content: body.content,
          user_id: 'u1',
          user_name: '测试用户',
          user_email: 'test@kanyun.com',
          created_at: '2026-04-24T12:00:00Z',
          updated_at: '2026-04-24T12:00:00Z',
        },
        { status: 201 }
      );
    }
  ),

  // --- Share links ---
  http.post(`${BASE}/api/spaces/:sid/share-links`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json(
      {
        ...mockShareLink,
        file_path: body.file_path,
        expires_at: body.expires_at ?? null,
        user_ids: body.user_ids ?? [],
        group_ids: body.group_ids ?? [],
      },
      { status: 201 }
    );
  }),

  http.get(`${BASE}/api/spaces/:sid/share-links`, () =>
    HttpResponse.json([mockShareLink])
  ),

  http.put(
    `${BASE}/api/spaces/:sid/share-links/:linkId`,
    async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ ...mockShareLink, ...body });
    }
  ),

  http.delete(`${BASE}/api/spaces/:sid/share-links/:linkId`, () =>
    HttpResponse.text('', { status: 200 })
  ),

  http.get(`${BASE}/api/share/:token`, ({ params }) => {
    if (params.token === 'xYz123AbC') {
      return HttpResponse.text('# Hello\nShared content.');
    }
    return HttpResponse.text('not found', { status: 404 });
  }),

  http.get(`${BASE}/api/share/:token/info`, ({ params }) => {
    if (params.token === 'xYz123AbC') {
      return HttpResponse.json(mockShareFileInfo);
    }
    return HttpResponse.text('not found', { status: 404 });
  }),

  // --- Diff ---
  http.get(`${BASE}/api/spaces/:sid/diff/:fp`, () =>
    HttpResponse.json(mockDiffResponse)
  ),

  http.get(`${BASE}/api/spaces/:sid/diff`, () =>
    HttpResponse.json(mockDiffSummary)
  ),

  // --- Resolve ---
  http.get(`${BASE}/api/spaces/by-slug/:slug`, ({ params }) => {
    if (params.slug === 'yanfa') {
      return HttpResponse.json(mockSpaces[0]);
    }
    return HttpResponse.text('not found', { status: 404 });
  }),

  http.get(`${BASE}/api/file-refs/:fileId`, ({ params }) => {
    if (params.fileId === 'NNjrcj8c') {
      return HttpResponse.json(mockFileRef);
    }
    return HttpResponse.text('not found', { status: 404 });
  })
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

  it('treeFull() returns recursive entries', async () => {
    const entries = await c.treeFull(SID);
    expect(entries).toHaveLength(3);
  });

  it('cat() returns content', async () => {
    const txt = await c.cat(SID, 'README.md');
    expect(txt).toContain('# Hello');
  });

  it('cat() throws on 404', async () => {
    await expect(c.cat(SID, 'nope.md')).rejects.toThrow('404');
  });

  it('catWithRef() returns content and X-Git-Ref', async () => {
    const result = await c.catWithRef(SID, 'README.md');
    expect(result.content).toContain('# Hello');
    expect(result.ref).toBe(HEAD_REF);
  });

  it('catWithRef() throws on 404', async () => {
    await expect(c.catWithRef(SID, 'nope.md')).rejects.toThrow('404');
  });

  it('upload() returns path', async () => {
    const r = await c.upload(SID, 'docs', 'test.md', '# Test');
    expect(r.path).toBe('docs/test.md');
  });

  it('save() returns path and ref', async () => {
    const r = await c.save(SID, 'test.md', '# Updated', {
      baseRef: HEAD_REF,
    });
    expect(r.path).toBe('test.md');
    expect(r.ref).toBe(NEW_REF);
  });

  it('save() with custom message', async () => {
    const r = await c.save(SID, 'test.md', '# Updated', {
      message: 'fix typo',
    });
    expect(r.ref).toBe(NEW_REF);
  });

  it('save() throws ConflictError on 409', async () => {
    try {
      await c.save(SID, 'test.md', '# Conflict', {
        baseRef: 'stale-ref',
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError);
      const conflict = err as ConflictError;
      expect(conflict.detail.error).toBe('conflict');
      expect(conflict.detail.current_ref).toBe(HEAD_REF);
      expect(conflict.message).toContain('modified by others');
    }
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

  it('rollback() succeeds', async () => {
    await expect(
      c.rollback(SID, 'README.md', 'abc1234')
    ).resolves.not.toThrow();
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

  it('trash() returns entries', async () => {
    const t = await c.trash(SID);
    expect(t).toHaveLength(1);
    expect(t[0].path).toBe('deleted.md');
  });

  it('restore() succeeds', async () => {
    await expect(
      c.restore(SID, 'deleted.md', 'del1234')
    ).resolves.not.toThrow();
  });

  it('rejects with 401 on bad token', async () => {
    const bad = new DocSyncClient(BASE, 'bad');
    await expect(bad.me()).rejects.toThrow('401');
  });

  // --- Comments ---
  it('listComments() returns comments with replies', async () => {
    const comments = await c.listComments(SID, 'README.md');
    expect(comments).toHaveLength(1);
    expect(comments[0].content).toBe('需要补充说明');
    expect(comments[0].replies).toHaveLength(1);
    expect(comments[0].replies[0].content).toBe('已补充');
  });

  it('createComment() returns new comment', async () => {
    const comment = await c.createComment(SID, 'README.md', '这里有个问题');
    expect(comment.id).toBe(43);
    expect(comment.content).toBe('这里有个问题');
    expect(comment.file_path).toBe('README.md');
  });

  it('replyComment() returns new reply', async () => {
    const reply = await c.replyComment(SID, 42, '已修复');
    expect(reply.id).toBe(102);
    expect(reply.content).toBe('已修复');
    expect(reply.comment_id).toBe(42);
  });

  it('closeComment() returns closed comment', async () => {
    const comment = await c.closeComment(SID, 42);
    expect(comment.is_closed).toBe(true);
  });

  it('deleteComment() succeeds', async () => {
    await expect(c.deleteComment(SID, 42)).resolves.not.toThrow();
  });

  // --- Share links ---
  it('createShareLink() returns link', async () => {
    const link = await c.createShareLink(SID, 'README.md');
    expect(link.token).toBe('xYz123AbC');
    expect(link.file_path).toBe('README.md');
  });

  it('createShareLink() with options', async () => {
    const link = await c.createShareLink(SID, 'README.md', {
      expiresAt: '2026-05-01T00:00:00Z',
      userIds: ['u2'],
      groupIds: ['g1'],
    });
    expect(link.user_ids).toEqual(['u2']);
    expect(link.group_ids).toEqual(['g1']);
  });

  it('listShareLinks() returns links', async () => {
    const links = await c.listShareLinks(SID);
    expect(links).toHaveLength(1);
    expect(links[0].token).toBe('xYz123AbC');
  });

  it('updateShareLink() succeeds', async () => {
    const link = await c.updateShareLink(SID, 'link-001', {
      expiresAt: '2026-06-01T00:00:00Z',
    });
    expect(link.expires_at).toBe('2026-06-01T00:00:00Z');
  });

  it('deleteShareLink() succeeds', async () => {
    await expect(c.deleteShareLink(SID, 'link-001')).resolves.not.toThrow();
  });

  it('getSharedFile() returns content', async () => {
    const content = await c.getSharedFile('xYz123AbC');
    expect(content).toContain('Shared content');
  });

  it('getSharedFileInfo() returns info', async () => {
    const info = await c.getSharedFileInfo('xYz123AbC');
    expect(info.file_path).toBe('README.md');
    expect(info.space_name).toBe('研发');
    expect(info.created_by_name).toBe('测试用户');
  });

  it('getSharedFile() throws on invalid token', async () => {
    await expect(c.getSharedFile('bad-token')).rejects.toThrow('404');
  });

  // --- Diff ---
  it('diffFile() returns diff', async () => {
    const result = await c.diffFile(SID, 'README.md', 'bbb2222', 'aaa1111');
    expect(result.diff).toContain('+# Hello World');
    expect(result.path).toBe('README.md');
  });

  it('diffFile() without from', async () => {
    const result = await c.diffFile(SID, 'README.md', 'bbb2222');
    expect(result.diff).toBeTruthy();
  });

  it('diffSummary() returns file list', async () => {
    const result = await c.diffSummary(SID, 'bbb2222', 'aaa1111');
    expect(result.files).toHaveLength(2);
    expect(result.files[0].status).toBe('M');
    expect(result.files[1].status).toBe('A');
  });

  // --- Resolve ---
  it('resolveBySlug() returns space', async () => {
    const space = await c.resolveBySlug('yanfa');
    expect(space.id).toBe(SID);
  });

  it('resolveBySlug() throws on unknown', async () => {
    await expect(c.resolveBySlug('nope')).rejects.toThrow('404');
  });

  it('resolveFileRef() returns ref', async () => {
    const ref = await c.resolveFileRef('NNjrcj8c');
    expect(ref.path).toBe('README.md');
    expect(ref.space_id).toBe(SID);
  });

  it('resolveFileRef() throws on unknown', async () => {
    await expect(c.resolveFileRef('bad')).rejects.toThrow('404');
  });
});
