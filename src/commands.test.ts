import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DocSyncClient } from './client.js';
import { parseExpires, parseTarget, resolveTarget } from './commands.js';

// ---------------------------------------------------------------------------
// Mock data & MSW server (mirrors client.test.ts)
// ---------------------------------------------------------------------------

const BASE = 'https://docz.test.com';
const TOKEN = 'test-token';
const SID = 'space-abc';

const mockSpaces = [
  {
    id: SID,
    name: '研发',
    slug: 'yanfa',
    owner_id: 'u1',
    is_private: false,
    created_at: '2026-03-24T09:00:00Z',
    member_count: 50,
  },
  {
    id: 'space-priv',
    name: '闫洪康',
    slug: 'yanhongkang',
    owner_id: 'u2',
    is_private: true,
    created_at: '2026-03-27T09:00:00Z',
    member_count: 1,
  },
];

const mockFileRef = {
  id: 'NNjrcj8c',
  space_id: 'space-priv',
  path: 'docs/guide.md',
};

const server = setupServer(
  http.get(`${BASE}/api/spaces`, () => HttpResponse.json(mockSpaces)),

  http.get(`${BASE}/api/spaces/by-slug/:slug`, ({ params }) => {
    const found = mockSpaces.find((s) => s.slug === params.slug);
    if (found) return HttpResponse.json(found);
    return HttpResponse.text('not found', { status: 404 });
  }),

  http.get(`${BASE}/api/file-refs/:fileId`, ({ params }) => {
    if (params.fileId === 'NNjrcj8c') return HttpResponse.json(mockFileRef);
    if (params.fileId === 'Hs8uQNNl')
      return HttpResponse.json({
        id: 'Hs8uQNNl',
        space_id: 'space-priv',
        path: 'AI-Coding技巧总结-摘要.md',
      });
    return HttpResponse.text('not found', { status: 404 });
  })
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ---------------------------------------------------------------------------
// parseExpires (existing tests)
// ---------------------------------------------------------------------------

describe('parseExpires', () => {
  it('parses days', () => {
    const result = parseExpires('7d');
    const expected = Date.now() + 7 * 86400000;
    const diff = Math.abs(new Date(result).getTime() - expected);
    expect(diff).toBeLessThan(1000);
  });

  it('parses hours', () => {
    const result = parseExpires('24h');
    const expected = Date.now() + 24 * 3600000;
    const diff = Math.abs(new Date(result).getTime() - expected);
    expect(diff).toBeLessThan(1000);
  });

  it('throws on invalid format', () => {
    expect(() => parseExpires('abc')).toThrow('Invalid expires format');
    expect(() => parseExpires('7m')).toThrow('Invalid expires format');
  });
});

// ---------------------------------------------------------------------------
// parseTarget
// ---------------------------------------------------------------------------

describe('parseTarget', () => {
  it('splits space:path by first colon', () => {
    expect(parseTarget(['研发:docs/guide.md'])).toEqual({
      space: '研发',
      path: 'docs/guide.md',
    });
  });

  it('handles path containing colons', () => {
    expect(parseTarget(['研发:file:with:colons.md'])).toEqual({
      space: '研发',
      path: 'file:with:colons.md',
    });
  });

  it('handles space-only (no colon)', () => {
    expect(parseTarget(['研发'])).toEqual({ space: '研发', path: '' });
  });

  it('handles space + separate path args', () => {
    expect(parseTarget(['研发', 'docs/guide.md'])).toEqual({
      space: '研发',
      path: 'docs/guide.md',
    });
  });
});

// ---------------------------------------------------------------------------
// resolveTarget — short URL support
// ---------------------------------------------------------------------------

describe('resolveTarget', () => {
  const client = new DocSyncClient(BASE, TOKEN);

  it('resolves /s/{slug}/f/{fileId} short URL', async () => {
    const result = await resolveTarget(client, [
      'https://docz.zhenguanyu.com/s/yanhongkang/f/NNjrcj8c',
    ]);
    expect(result.spaceId).toBe('space-priv');
    expect(result.path).toBe('docs/guide.md');
  });

  it('resolves /s/{slug} short URL (directory)', async () => {
    const result = await resolveTarget(client, [
      'https://docz.zhenguanyu.com/s/yanfa',
    ]);
    expect(result.spaceId).toBe(SID);
    expect(result.path).toBe('');
  });

  it('resolves short URL with trailing slash', async () => {
    const result = await resolveTarget(client, [
      'https://docz.zhenguanyu.com/s/yanfa/',
    ]);
    expect(result.spaceId).toBe(SID);
    expect(result.path).toBe('');
  });

  it('resolves short URL with query params', async () => {
    const result = await resolveTarget(client, [
      'https://docz.zhenguanyu.com/s/yanfa?tab=files',
    ]);
    expect(result.spaceId).toBe(SID);
    expect(result.path).toBe('');
  });

  it('resolves another file short URL', async () => {
    const result = await resolveTarget(client, [
      'https://docz.zhenguanyu.com/s/yanhongkang/f/Hs8uQNNl',
    ]);
    expect(result.spaceId).toBe('space-priv');
    expect(result.path).toBe('AI-Coding技巧总结-摘要.md');
  });

  it('falls back to parseTarget for non-URL input', async () => {
    const result = await resolveTarget(client, ['研发:docs/guide.md']);
    expect(result.spaceId).toBe(SID);
    expect(result.path).toBe('docs/guide.md');
  });

  it('falls back to parseTarget for space-only input', async () => {
    const result = await resolveTarget(client, ['研发']);
    expect(result.spaceId).toBe(SID);
    expect(result.path).toBe('');
  });

  it('throws on unknown slug in short URL', async () => {
    await expect(
      resolveTarget(client, [
        'https://docz.zhenguanyu.com/s/nonexistent/f/NNjrcj8c',
      ])
    ).rejects.toThrow();
  });

  it('throws on unknown fileId in short URL', async () => {
    await expect(
      resolveTarget(client, [
        'https://docz.zhenguanyu.com/s/yanhongkang/f/BADID',
      ])
    ).rejects.toThrow();
  });

  it('works with http:// (not just https://)', async () => {
    const result = await resolveTarget(client, [
      'http://docz.zhenguanyu.com/s/yanfa',
    ]);
    expect(result.spaceId).toBe(SID);
    expect(result.path).toBe('');
  });
});
