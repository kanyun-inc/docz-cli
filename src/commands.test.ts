import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { DocSyncClient, MoveError } from './client.js';
import {
  describeMoveFailure,
  IMAGE_MAX_SIZE,
  mapNormalLinkInfo,
  mapShareLinkInfo,
  markdownImageRef,
  parseExpires,
  parseNormalLink,
  parseTarget,
  readImageFile,
  registerCommands,
  resolveSpaceArg,
  resolveTarget,
  validateDestinationPath,
} from './commands.js';

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

const mockFullTree = [
  { path: 'README.md', type: 'blob', size: 1024 },
  { path: 'docs', type: 'tree', size: 0 },
  { path: 'docs/guide.md', type: 'blob', size: 512 },
  { path: 'docs/nested/example.md', type: 'blob', size: 256 },
  { path: 'docs-old/archive.md', type: 'blob', size: 128 },
];

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
  }),

  http.get(`${BASE}/api/spaces/:sid/tree/full`, () =>
    HttpResponse.json(mockFullTree)
  )
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  Reflect.deleteProperty(globalThis, '__VERSION__');
});
afterAll(() => server.close());

// ---------------------------------------------------------------------------
// ls -R
// ---------------------------------------------------------------------------

async function runRecursiveLs(target: string): Promise<string[]> {
  vi.stubEnv('DOCSYNC_BASE_URL', BASE);
  vi.stubEnv('DOCSYNC_API_TOKEN', TOKEN);
  Reflect.set(globalThis, '__VERSION__', 'test');
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
    lines.push(String(message));
  });

  const program = new Command().exitOverride();
  registerCommands(program);
  await program.parseAsync(['ls', '-R', target], { from: 'user' });
  return lines;
}

describe('ls -R', () => {
  it('prints full paths from the Space root without undefined names', async () => {
    const lines = await runRecursiveLs('研发');

    expect(lines).toContain('README.md\t1.0 KB');
    expect(lines).toContain('docs/guide.md\t512 B');
    expect(lines.join('\n')).not.toContain('undefined');
  });

  it('prints only entries below the requested subdirectory', async () => {
    const lines = await runRecursiveLs('研发:docs');

    expect(lines).toEqual([
      'docs/guide.md\t512 B',
      'docs/nested/example.md\t256 B',
    ]);
  });
});

// ---------------------------------------------------------------------------
// mv destination semantics
// ---------------------------------------------------------------------------

describe('validateDestinationPath', () => {
  it.each(['new.md', 'archive/new.md', '归档/新文档.md', 'a.b/文档 1.md'])(
    'accepts a Space-root-relative path: %s',
    (path) => {
      expect(validateDestinationPath(path)).toBeNull();
    }
  );

  it.each([
    '',
    '/absolute.md',
    'archive//new.md',
    './new.md',
    '../new.md',
    'archive\\new.md',
    'CON.md',
    'archive/trailing.',
    `${'界'.repeat(86)}.md`,
  ])('rejects a non-portable destination: %s', (path) => {
    expect(validateDestinationPath(path)).not.toBeNull();
  });
});

describe('describeMoveFailure', () => {
  it('shows the resolved paths and mkdir hint for a missing parent', () => {
    const result = describeMoveFailure(
      new MoveError(404, {
        error: 'destination_parent_not_found',
        message: 'Destination parent directory does not exist',
        outcome: 'failed',
        old_path: 'docs/a.md',
        new_path: 'archive/b.md',
        parent_path: 'archive',
      }),
      SID,
      'docs/a.md',
      'archive/b.md'
    );

    expect(result.exitCode).toBe(1);
    expect(result.lines).toContain('Resolved move: docs/a.md → archive/b.md');
    expect(result.lines.join('\n')).toContain(`docz mkdir ${SID}:archive`);
  });

  it('uses exit code 2 and warns before retrying an unknown outcome', () => {
    const result = describeMoveFailure(
      new MoveError(503, {
        error: 'move_status_unknown',
        message: 'Move result is unknown',
        outcome: 'unknown',
      }),
      SID,
      'a.md',
      'b.md'
    );

    expect(result.exitCode).toBe(2);
    expect(result.lines.join('\n')).toContain(
      'verify both source and destination'
    );
  });
});

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

describe('parseNormalLink', () => {
  it('parses stable, slug-path, root, and legacy URLs', () => {
    expect(
      parseNormalLink('https://docz.example.com/s/yanfa/f/NNjrcj8c')
    ).toEqual({
      kind: 'file-ref',
      slug: 'yanfa',
      fileId: 'NNjrcj8c',
      path: '',
    });
    expect(
      parseNormalLink(
        'https://docz.example.com/s/yanfa/%E6%96%87%E6%A1%A3/guide.md'
      )
    ).toEqual({
      kind: 'path',
      slug: 'yanfa',
      path: '文档/guide.md',
    });
    expect(parseNormalLink('https://docz.example.com/s/yanfa')).toEqual({
      kind: 'path',
      slug: 'yanfa',
      path: '',
    });
    expect(
      parseNormalLink('https://docz.example.com/spaces/space-1/docs')
    ).toEqual({
      kind: 'path',
      spaceId: 'space-1',
      path: 'docs',
    });
  });

  it('rejects share and unknown URLs', () => {
    expect(() =>
      parseNormalLink('https://docz.example.com/share/token')
    ).toThrow('docz share info');
    expect(() => parseNormalLink('https://docz.example.com/settings')).toThrow(
      'Unrecognized ordinary Docz URL'
    );
  });
});

describe('link metadata mapping', () => {
  it('keeps link, permission, and document status independent', () => {
    expect(
      mapNormalLinkInfo({
        link_valid: true,
        space_exists: true,
        has_space_access: false,
        document_applicable: true,
        document_exists: false,
        path: 'deleted.md',
        is_dir: false,
        owner_name: '管理员',
        owner_email: 'owner@example.com',
      })
    ).toEqual({
      link_type: 'normal',
      link_status: 'valid',
      space_permission: 'inaccessible',
      document_path: '/deleted.md',
      document_status: 'not_found',
      space_admin: { name: '管理员', email: 'owner@example.com' },
      is_folder: false,
    });
  });

  it('marks a space root as not applicable document and folder', () => {
    expect(
      mapNormalLinkInfo({
        link_valid: true,
        space_exists: true,
        has_space_access: true,
        document_applicable: false,
        document_exists: true,
        path: '',
        is_dir: true,
      })
    ).toMatchObject({
      document_path: '/',
      document_status: 'not_applicable',
      is_folder: true,
    });
  });

  it('does not classify an invalid link as a missing document', () => {
    expect(
      mapNormalLinkInfo({
        link_valid: false,
        space_exists: false,
        has_space_access: false,
        document_applicable: true,
        document_exists: false,
      })
    ).toMatchObject({
      link_status: 'invalid',
      space_permission: 'not_applicable',
      document_path: null,
      document_status: 'unknown',
    });
  });

  it('uses a share-specific output contract', () => {
    expect(
      mapShareLinkInfo({
        link_status: 'valid',
        access_status: 'accessible',
        info: {
          file_path: 'docs/guide.md',
          file_name: 'guide.md',
          space_id: SID,
          space_name: '研发',
          created_by_name: '分享人',
          expires_at: null,
          has_space_access: false,
          role: 'viewer',
          is_public: false,
          is_dir: false,
          document_exists: true,
        },
      })
    ).toEqual({
      link_status: 'valid',
      access_status: 'accessible',
      visibility: 'restricted',
      space_name: '研发',
      document_path: '/docs/guide.md',
      document_status: 'exists',
      role: 'viewer',
      shared_by: '分享人',
      expires_at: null,
      is_folder: false,
      has_space_access: false,
    });
    expect(
      mapShareLinkInfo({
        link_status: 'expired',
        access_status: 'unknown',
      })
    ).toMatchObject({
      link_status: 'expired',
      document_status: 'unknown',
      document_path: null,
    });
  });
});

// ---------------------------------------------------------------------------
// resolveTarget — short URL support
// ---------------------------------------------------------------------------

describe('resolveTarget', () => {
  const client = new DocSyncClient(BASE, TOKEN);

  // --- short URL: /s/{slug}/f/{fileId} ---
  it('resolves /s/{slug}/f/{fileId} short URL', async () => {
    const result = await resolveTarget(client, [
      'https://docz.zhenguanyu.com/s/yanhongkang/f/NNjrcj8c',
    ]);
    expect(result.spaceId).toBe('space-priv');
    expect(result.path).toBe('docs/guide.md');
  });

  it('resolves another file short URL', async () => {
    const result = await resolveTarget(client, [
      'https://docz.zhenguanyu.com/s/yanhongkang/f/Hs8uQNNl',
    ]);
    expect(result.spaceId).toBe('space-priv');
    expect(result.path).toBe('AI-Coding技巧总结-摘要.md');
  });

  it('uses the canonical file-ref Space after a cross-Space move', async () => {
    server.use(
      http.get(`${BASE}/api/file-refs/:fileId`, () =>
        HttpResponse.json({
          id: 'NNjrcj8c',
          space_id: 'space-after-move',
          path: 'moved/Budget.sheet.json',
        })
      )
    );
    const result = await resolveTarget(client, [
      'https://docz.zhenguanyu.com/s/yanhongkang/f/NNjrcj8c',
    ]);
    expect(result).toEqual({
      spaceId: 'space-after-move',
      path: 'moved/Budget.sheet.json',
    });
  });

  it('strips #fragment from fileId in short URL', async () => {
    const result = await resolveTarget(client, [
      'https://docz.zhenguanyu.com/s/yanhongkang/f/NNjrcj8c#section-2',
    ]);
    expect(result.spaceId).toBe('space-priv');
    expect(result.path).toBe('docs/guide.md');
  });

  it('throws on unknown fileId in short URL', async () => {
    await expect(
      resolveTarget(client, [
        'https://docz.zhenguanyu.com/s/yanhongkang/f/BADID',
      ])
    ).rejects.toThrow();
  });

  // --- slug URL: /s/{slug}[/path] ---
  it('resolves /s/{slug} (space root)', async () => {
    const result = await resolveTarget(client, [
      'https://docz.zhenguanyu.com/s/yanfa',
    ]);
    expect(result.spaceId).toBe(SID);
    expect(result.path).toBe('');
  });

  it('resolves /s/{slug}/ with trailing slash', async () => {
    const result = await resolveTarget(client, [
      'https://docz.zhenguanyu.com/s/yanfa/',
    ]);
    expect(result.spaceId).toBe(SID);
    expect(result.path).toBe('');
  });

  it('resolves /s/{slug}/path/to/file.md (path URL)', async () => {
    const result = await resolveTarget(client, [
      'https://docz.zhenguanyu.com/s/yanfa/docs/guide.md',
    ]);
    expect(result.spaceId).toBe(SID);
    expect(result.path).toBe('docs/guide.md');
  });

  it('resolves /s/{slug}/subdir (directory path URL)', async () => {
    const result = await resolveTarget(client, [
      'https://docz.zhenguanyu.com/s/yanfa/docs',
    ]);
    expect(result.spaceId).toBe(SID);
    expect(result.path).toBe('docs');
  });

  it('resolves path URL with ?view=file query param', async () => {
    const result = await resolveTarget(client, [
      'https://docz.zhenguanyu.com/s/yanfa/docs/guide.md?view=file',
    ]);
    expect(result.spaceId).toBe(SID);
    expect(result.path).toBe('docs/guide.md');
  });

  it('resolves slug URL with query params', async () => {
    const result = await resolveTarget(client, [
      'https://docz.zhenguanyu.com/s/yanfa?tab=files',
    ]);
    expect(result.spaceId).toBe(SID);
    expect(result.path).toBe('');
  });

  it('strips #fragment from slug URL', async () => {
    const result = await resolveTarget(client, [
      'https://docz.zhenguanyu.com/s/yanfa#readme',
    ]);
    expect(result.spaceId).toBe(SID);
    expect(result.path).toBe('');
  });

  it('decodes percent-encoded path in URL', async () => {
    const result = await resolveTarget(client, [
      'https://docz.zhenguanyu.com/s/yanfa/%E6%96%87%E6%A1%A3/guide.md',
    ]);
    expect(result.spaceId).toBe(SID);
    expect(result.path).toBe('文档/guide.md');
  });

  // --- legacy URL: /spaces/{spaceId}[/path] ---
  it('resolves /spaces/{spaceId} (legacy root)', async () => {
    const result = await resolveTarget(client, [
      `https://docz.zhenguanyu.com/spaces/${SID}`,
    ]);
    expect(result.spaceId).toBe(SID);
    expect(result.path).toBe('');
  });

  it('resolves /spaces/{spaceId}/path (legacy with path)', async () => {
    const result = await resolveTarget(client, [
      `https://docz.zhenguanyu.com/spaces/${SID}/docs/guide.md`,
    ]);
    expect(result.spaceId).toBe(SID);
    expect(result.path).toBe('docs/guide.md');
  });

  // --- fallback to parseTarget ---
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

  // --- error cases ---
  it('throws on unknown slug in short URL', async () => {
    await expect(
      resolveTarget(client, [
        'https://docz.zhenguanyu.com/s/nonexistent/f/NNjrcj8c',
      ])
    ).rejects.toThrow();
  });

  it('throws on unrecognized URL instead of falling through', async () => {
    await expect(
      resolveTarget(client, ['https://docz.zhenguanyu.com/unknown/path'])
    ).rejects.toThrow('Unrecognized DocSync URL');
  });

  it('throws on URL with no matching pattern', async () => {
    await expect(
      resolveTarget(client, ['https://example.com/some/page'])
    ).rejects.toThrow('Unrecognized DocSync URL');
  });

  // --- protocol ---
  it('works with http:// (not just https://)', async () => {
    const result = await resolveTarget(client, [
      'http://docz.zhenguanyu.com/s/yanfa',
    ]);
    expect(result.spaceId).toBe(SID);
    expect(result.path).toBe('');
  });
});

// ---------------------------------------------------------------------------
// resolveSpaceArg — space-only commands with URL support
// ---------------------------------------------------------------------------

describe('resolveSpaceArg', () => {
  const client = new DocSyncClient(BASE, TOKEN);

  it('resolves space by name', async () => {
    const s = await resolveSpaceArg(client, '研发');
    expect(s.id).toBe(SID);
  });

  it('resolves space by id', async () => {
    const s = await resolveSpaceArg(client, SID);
    expect(s.id).toBe(SID);
  });

  it('extracts space from /s/{slug}/f/{fileId} URL', async () => {
    const s = await resolveSpaceArg(
      client,
      'https://docz.zhenguanyu.com/s/yanhongkang/f/NNjrcj8c'
    );
    expect(s.id).toBe('space-priv');
  });

  it('extracts space from /s/{slug} URL', async () => {
    const s = await resolveSpaceArg(
      client,
      'https://docz.zhenguanyu.com/s/yanfa'
    );
    expect(s.id).toBe(SID);
  });

  it('extracts space from /s/{slug}/path URL', async () => {
    const s = await resolveSpaceArg(
      client,
      'https://docz.zhenguanyu.com/s/yanfa/docs/guide.md'
    );
    expect(s.id).toBe(SID);
  });

  it('extracts space from /spaces/{id}/path legacy URL', async () => {
    const s = await resolveSpaceArg(
      client,
      `https://docz.zhenguanyu.com/spaces/${SID}/docs/guide.md`
    );
    expect(s.id).toBe(SID);
  });

  it('extracts space from URL with #fragment', async () => {
    const s = await resolveSpaceArg(
      client,
      'https://docz.zhenguanyu.com/s/yanfa#readme'
    );
    expect(s.id).toBe(SID);
  });

  it('extracts space from URL with query params', async () => {
    const s = await resolveSpaceArg(
      client,
      'https://docz.zhenguanyu.com/s/yanfa?tab=files'
    );
    expect(s.id).toBe(SID);
  });

  it('throws on unrecognized URL', async () => {
    await expect(
      resolveSpaceArg(client, 'https://example.com/no-slug')
    ).rejects.toThrow('Unrecognized DocSync URL');
  });
});

// ---------------------------------------------------------------------------
// readImageFile — local validation for image upload (CLI + MCP shared)
// ---------------------------------------------------------------------------

describe('readImageFile', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docz-img-'));

  it('reads a valid png file', () => {
    const file = join(dir, 'shot.png');
    writeFileSync(file, Buffer.from('fake-png'));
    const result = readImageFile(file);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.filename).toBe('shot.png');
      expect(result.content.toString()).toBe('fake-png');
    }
  });

  it('rejects nonexistent file without reading', () => {
    const result = readImageFile(join(dir, 'nope.png'));
    expect(result).toEqual({
      error: `File not found: ${join(dir, 'nope.png')}`,
    });
  });

  it('rejects unsupported extension (gif)', () => {
    const file = join(dir, 'anim.gif');
    writeFileSync(file, Buffer.from('GIF89a'));
    const result = readImageFile(file);
    expect('error' in result && result.error).toContain(
      'Unsupported image type'
    );
    expect('error' in result && result.error).toContain('png, jpg, jpeg, webp');
  });

  it('rejects file exceeding 5MB', () => {
    const file = join(dir, 'big.png');
    writeFileSync(file, Buffer.alloc(IMAGE_MAX_SIZE + 1));
    const result = readImageFile(file);
    expect('error' in result && result.error).toContain('Image too large');
  });

  it('accepts uppercase extension', () => {
    const file = join(dir, 'SHOT.PNG');
    writeFileSync(file, Buffer.from('fake-png'));
    const result = readImageFile(file);
    expect('error' in result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// markdownImageRef
// ---------------------------------------------------------------------------

describe('markdownImageRef', () => {
  it('uses filename minus extension as alt text', () => {
    expect(markdownImageRef('shot.png', 'https://oss/x.png')).toBe(
      '![shot](https://oss/x.png)'
    );
  });

  it('handles dots in filename', () => {
    expect(markdownImageRef('a.b.png', 'u')).toBe('![a.b](u)');
  });
});
