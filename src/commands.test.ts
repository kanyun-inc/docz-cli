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
  diagnoseNormalLinkTarget,
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
const originalExitCode = process.exitCode;

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
  slug: 'yanhongkang',
  path: 'docs/guide.md',
  is_dir: false,
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
    if (params.fileId === 'DIR12345')
      return HttpResponse.json({
        id: 'DIR12345',
        space_id: 'space-priv',
        slug: 'yanhongkang',
        path: 'docs',
        is_dir: true,
      });
    if (params.fileId === 'Hs8uQNNl')
      return HttpResponse.json({
        id: 'Hs8uQNNl',
        space_id: 'space-priv',
        slug: 'yanhongkang',
        path: 'AI-Coding技巧总结-摘要.md',
        is_dir: false,
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
  process.exitCode = originalExitCode;
});
afterAll(() => server.close());

// ---------------------------------------------------------------------------
// Sheet machine output
// ---------------------------------------------------------------------------

async function runSheetCommand(
  args: string[],
  token?: string
): Promise<{
  output: Record<string, unknown>;
  exitCode: string | number | null | undefined;
}> {
  vi.stubEnv('DOCSYNC_BASE_URL', BASE);
  vi.stubEnv('DOCSYNC_API_TOKEN', token ?? '');
  Reflect.set(globalThis, '__VERSION__', 'test');
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
    lines.push(String(message));
  });
  const program = new Command().exitOverride();
  registerCommands(program);
  await program.parseAsync(args, { from: 'user' });
  expect(lines).toHaveLength(1);
  return {
    output: JSON.parse(lines[0]) as Record<string, unknown>,
    exitCode: process.exitCode,
  };
}

describe('Sheet machine output', () => {
  it('returns JSON when authentication is missing', async () => {
    const result = await runSheetCommand([
      'sheet',
      'get',
      '研发:Budget.sheet.json',
      '--range',
      'Sheet1!A1',
      '--json',
    ]);
    expect(result.output).toMatchObject({
      outcome: 'FAILED',
      phase: 'load',
      unit_id: null,
      identity_resolved: false,
      failure_code: 'authentication_required',
    });
    expect(result.exitCode).toBe(1);
  });

  it('returns JSON for missing required Sheet arguments', async () => {
    const result = await runSheetCommand(
      ['sheet', 'set', '--range', 'Sheet1!A1', '--json'],
      TOKEN
    );
    expect(result.output).toMatchObject({
      outcome: 'FAILED',
      phase: 'validate',
      unit_id: null,
      identity_resolved: false,
      failure_code: 'sheet_target_invalid',
    });
    expect(result.exitCode).toBe(1);
  });

  it('returns bounded JSON when the session request is forbidden', async () => {
    const sensitive = 'sessionTicket=never-log';
    server.use(
      http.get(`${BASE}/api/spaces/:sid/sheets/session`, () =>
        HttpResponse.text(sensitive, { status: 403 })
      )
    );
    const result = await runSheetCommand(
      [
        'sheet',
        'get',
        '研发:Budget.sheet.json',
        '--range',
        'Sheet1!A1',
        '--json',
      ],
      TOKEN
    );
    expect(result.output).toMatchObject({
      outcome: 'FAILED',
      phase: 'load',
      space_id: SID,
      path: 'Budget.sheet.json',
      unit_id: null,
      identity_resolved: false,
      failure_code: 'collaboration_permission_denied',
    });
    expect(JSON.stringify(result.output)).not.toContain(sensitive);
    expect(result.exitCode).toBe(1);
  });

  it('preserves a target-resolution network failure as collaboration_unavailable', async () => {
    server.use(http.get(`${BASE}/api/spaces`, () => HttpResponse.error()));
    const result = await runSheetCommand(
      [
        'sheet',
        'get',
        '研发:Budget.sheet.json',
        '--range',
        'Sheet1!A1',
        '--json',
      ],
      TOKEN
    );
    expect(result.output).toMatchObject({
      outcome: 'FAILED',
      phase: 'load',
      identity_resolved: false,
      failure_code: 'collaboration_unavailable',
    });
    expect(result.exitCode).toBe(1);
  });

  it('preserves target-resolution authorization failure as permission denied', async () => {
    server.use(
      http.get(`${BASE}/api/spaces`, () =>
        HttpResponse.text('unauthorized', { status: 401 })
      )
    );
    const result = await runSheetCommand(
      [
        'sheet',
        'get',
        '研发:Budget.sheet.json',
        '--range',
        'Sheet1!A1',
        '--json',
      ],
      TOKEN
    );
    expect(result.output).toMatchObject({
      outcome: 'FAILED',
      phase: 'load',
      identity_resolved: false,
      failure_code: 'collaboration_permission_denied',
    });
    expect(result.exitCode).toBe(1);
  });
});

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
      childPath: '',
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

  it('parses a stable directory child path without query or fragment', () => {
    expect(
      parseNormalLink(
        'https://docz.example.com/s/yanhongkang/f/DIR12345/%E5%AD%90%E7%9B%AE%E5%BD%95/guide.md?view=file#intro'
      )
    ).toEqual({
      kind: 'file-ref',
      slug: 'yanhongkang',
      fileId: 'DIR12345',
      childPath: '子目录/guide.md',
    });
    expect(
      parseNormalLink('https://docz.example.com/s/yanhongkang/f/DIR12345/')
    ).toMatchObject({ kind: 'file-ref', childPath: '' });
  });

  it.each([
    'https://docz.example.com/s/yanhongkang/f/DIR12345//guide.md',
    'https://docz.example.com/s/yanhongkang/f/DIR12345/guide.md/',
    'https://docz.example.com/s/yanhongkang/f/DIR12345/./guide.md',
    'https://docz.example.com/s/yanhongkang/f/DIR12345/../guide.md',
    'https://docz.example.com/s/yanhongkang/f/DIR12345/%2e%2e/guide.md',
    'https://docz.example.com/s/yanhongkang/f/DIR12345/a%2Fb.md',
    'https://docz.example.com/s/yanhongkang/f/DIR12345/a%5Cb.md',
    'https://docz.example.com/s/yanhongkang/f/DIR12345/a%00b.md',
  ])('rejects an unsafe stable-link child path: %s', (url) => {
    expect(() => parseNormalLink(url)).toThrow('stable-link child path');
  });

  it('does not fall back to an ordinary path for invalid stable routes', () => {
    expect(() =>
      parseNormalLink('https://docz.example.com/s/yanhongkang/f//guide.md')
    ).toThrow('stable-link fileId');
    expect(() =>
      parseNormalLink('https://docz.example.com/s/yanhongkang/%66//guide.md')
    ).toThrow('stable-link fileId');
  });

  it.each([
    'https://docz.example.com/x/../s/yanhongkang/f/DIR12345/child.md',
    'https://docz.example.com/x/%2e%2e/s/yanhongkang/f/DIR12345/child.md',
  ])(
    'does not fall back when normalization exposes a stable route: %s',
    (url) => {
      expect(() => parseNormalLink(url)).toThrow(
        'Invalid stable-link URL path: route normalization is not allowed'
      );
    }
  );

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

  it('aligns every human-readable value to the same column', async () => {
    server.use(
      http.get(`${BASE}/api/file-refs/:fileId/diagnostic`, () =>
        HttpResponse.json({
          link_valid: true,
          space_exists: true,
          has_space_access: true,
          document_applicable: true,
          document_exists: true,
          path: 'Budget.sheet.json',
          is_dir: false,
          owner_name: '管理员',
          owner_email: 'owner@example.com',
        })
      )
    );
    vi.stubEnv('DOCSYNC_BASE_URL', BASE);
    vi.stubEnv('DOCSYNC_API_TOKEN', TOKEN);
    Reflect.set(globalThis, '__VERSION__', 'test');
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      lines.push(String(message));
    });

    const program = new Command().exitOverride();
    registerCommands(program);
    await program.parseAsync(
      ['link', 'info', 'https://docz.example.com/s/yanfa/f/NNjrcj8c'],
      { from: 'user' }
    );

    expect(lines).toEqual([
      'Link type:        normal',
      'Link status:      valid',
      'Space permission: accessible',
      'Document path:    /Budget.sheet.json',
      'Document status:  exists',
      'Space admin:      管理员 <owner@example.com>',
      'Folder:           false',
    ]);
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

describe('stable child link diagnostics', () => {
  const client = new DocSyncClient(BASE, TOKEN);
  const childUrl =
    'https://docz.example.com/s/yanhongkang/f/DIR12345/nested/child.md';
  const accessibleDirectory = {
    link_valid: true,
    space_exists: true,
    has_space_access: true,
    document_applicable: true,
    document_exists: true,
    id: 'DIR12345',
    space_id: 'space-priv',
    slug: 'yanhongkang',
    path: 'docs',
    is_dir: true,
    owner_name: '管理员',
    owner_email: 'owner@example.com',
  };

  it('diagnoses the canonical child path', async () => {
    server.use(
      http.get(`${BASE}/api/file-refs/:fileId/diagnostic`, () =>
        HttpResponse.json(accessibleDirectory)
      ),
      http.get(`${BASE}/api/link-diagnostics/path`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('space_id')).toBe('space-priv');
        expect(url.searchParams.get('path')).toBe('docs/nested/child.md');
        return HttpResponse.json({
          link_valid: true,
          space_exists: true,
          has_space_access: true,
          document_applicable: true,
          document_exists: true,
          space_id: 'space-priv',
          path: 'docs/nested/child.md',
          is_dir: false,
        });
      })
    );

    const result = await diagnoseNormalLinkTarget(
      client,
      parseNormalLink(childUrl)
    );
    expect(result).toEqual({
      info: {
        link_type: 'normal',
        link_status: 'valid',
        space_permission: 'accessible',
        document_path: '/docs/nested/child.md',
        document_status: 'exists',
        space_admin: null,
        is_folder: false,
      },
    });
  });

  it('keeps a canonical missing child valid and reports not_found', async () => {
    server.use(
      http.get(`${BASE}/api/file-refs/:fileId/diagnostic`, () =>
        HttpResponse.json(accessibleDirectory)
      ),
      http.get(`${BASE}/api/link-diagnostics/path`, () =>
        HttpResponse.json({
          link_valid: true,
          space_exists: true,
          has_space_access: true,
          document_applicable: true,
          document_exists: false,
          space_id: 'space-priv',
          path: 'docs/nested/child.md',
        })
      )
    );

    const result = await diagnoseNormalLinkTarget(
      client,
      parseNormalLink(childUrl)
    );
    expect(result.info).toMatchObject({
      link_status: 'valid',
      document_path: '/docs/nested/child.md',
      document_status: 'not_found',
    });
  });

  it.each([
    [
      'invalid',
      {
        ...accessibleDirectory,
        link_valid: false,
        space_exists: false,
        has_space_access: false,
      },
    ],
    [
      'inaccessible',
      { ...accessibleDirectory, has_space_access: false, path: undefined },
    ],
    [
      'deleted',
      { ...accessibleDirectory, document_exists: false, path: undefined },
    ],
    ['non-directory', { ...accessibleDirectory, is_dir: false }],
    ['missing directory type', { ...accessibleDirectory, is_dir: undefined }],
  ])(
    'does not issue a child diagnostic when the parent is %s',
    async (_label, parent) => {
      let childDiagnosticRequests = 0;
      server.use(
        http.get(`${BASE}/api/file-refs/:fileId/diagnostic`, () =>
          HttpResponse.json(parent)
        ),
        http.get(`${BASE}/api/link-diagnostics/path`, () => {
          childDiagnosticRequests += 1;
          return HttpResponse.json({});
        })
      );

      const result = await diagnoseNormalLinkTarget(
        client,
        parseNormalLink(childUrl)
      );
      expect(childDiagnosticRequests).toBe(0);
      expect(result.warning).toContain('could not be resolved safely');
      expect(result.info).toMatchObject({
        document_path: null,
        document_status: 'unknown',
        is_folder: null,
      });
    }
  );

  it('powers link info --json with the canonical child result', async () => {
    server.use(
      http.get(`${BASE}/api/file-refs/:fileId/diagnostic`, () =>
        HttpResponse.json(accessibleDirectory)
      ),
      http.get(`${BASE}/api/link-diagnostics/path`, () =>
        HttpResponse.json({
          link_valid: true,
          space_exists: true,
          has_space_access: true,
          document_applicable: true,
          document_exists: true,
          space_id: 'space-priv',
          path: 'docs/nested/child.md',
          is_dir: false,
        })
      )
    );
    vi.stubEnv('DOCSYNC_BASE_URL', BASE);
    vi.stubEnv('DOCSYNC_API_TOKEN', TOKEN);
    Reflect.set(globalThis, '__VERSION__', 'test');
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      lines.push(String(message));
    });

    const program = new Command().exitOverride();
    registerCommands(program);
    await program.parseAsync(['link', 'info', childUrl, '--json'], {
      from: 'user',
    });

    expect(JSON.parse(lines.at(-1) ?? '{}')).toMatchObject({
      document_path: '/docs/nested/child.md',
      document_status: 'exists',
    });
    expect(process.exitCode).toBeUndefined();
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

  it('rejects an old stable link after a cross-Space move', async () => {
    server.use(
      http.get(`${BASE}/api/file-refs/:fileId`, () =>
        HttpResponse.json({
          id: 'NNjrcj8c',
          space_id: 'space-after-move',
          path: 'moved/Budget.sheet.json',
        })
      )
    );
    await expect(
      resolveTarget(client, [
        'https://docz.zhenguanyu.com/s/yanhongkang/f/NNjrcj8c',
      ])
    ).rejects.toThrow('Stable link Space mismatch');
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

  it('resolves a stable directory child below the canonical path', async () => {
    const result = await resolveTarget(client, [
      'https://docz.zhenguanyu.com/s/yanhongkang/f/DIR12345/nested/%E6%96%87%E6%A1%A3.md',
    ]);
    expect(result).toEqual({
      spaceId: 'space-priv',
      path: 'docs/nested/文档.md',
    });
  });

  it('rejects a child path when the fileId points to a file', async () => {
    await expect(
      resolveTarget(client, [
        'https://docz.zhenguanyu.com/s/yanhongkang/f/NNjrcj8c/child.md',
      ])
    ).rejects.toThrow('requires a directory fileId');
  });

  it('rejects a slug and fileId Space mismatch', async () => {
    await expect(
      resolveTarget(client, [
        'https://docz.zhenguanyu.com/s/yanfa/f/DIR12345/child.md',
      ])
    ).rejects.toThrow('Stable link Space mismatch');
  });

  it('does not make a path request after stable parent resolution fails', async () => {
    let pathRequests = 0;
    server.use(
      http.all(`${BASE}/api/spaces/:spaceId/*`, () => {
        pathRequests += 1;
        return HttpResponse.json({});
      })
    );

    await expect(
      resolveTarget(client, [
        'https://docz.zhenguanyu.com/s/yanhongkang/f/BADID/child.md',
      ])
    ).rejects.toThrow();
    expect(pathRequests).toBe(0);
  });

  it.each([
    'https://docz.zhenguanyu.com/x/../s/yanhongkang/f/DIR12345/child.md',
    'https://docz.zhenguanyu.com/x/%2e%2e/s/yanhongkang/f/DIR12345/child.md',
  ])(
    'fails closed before network access when normalization exposes a stable route: %s',
    async (url) => {
      let requests = 0;
      server.use(
        http.all('*', () => {
          requests += 1;
          return HttpResponse.json({});
        })
      );

      await expect(resolveTarget(client, [url])).rejects.toThrow(
        'Invalid stable-link URL path: route normalization is not allowed'
      );
      expect(requests).toBe(0);
    }
  );

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

describe('stable child URL command integration', () => {
  it('passes canonical child paths to read and mutation APIs', async () => {
    const seen: Array<{
      operation: string;
      path: string;
      destination?: string;
    }> = [];
    server.use(
      http.get(`${BASE}/api/spaces/space-priv/blob/*`, ({ request }) => {
        seen.push({
          operation: 'cat',
          path: decodeURIComponent(new URL(request.url).pathname).replace(
            '/api/spaces/space-priv/blob/',
            ''
          ),
        });
        return HttpResponse.text('content');
      }),
      http.post(
        `${BASE}/api/spaces/space-priv/files/save`,
        async ({ request }) => {
          const body = (await request.json()) as { path: string };
          seen.push({ operation: 'write', path: body.path });
          return HttpResponse.json({ path: body.path, ref: 'save-ref' });
        }
      ),
      http.post(
        `${BASE}/api/spaces/space-priv/files/mkdir`,
        async ({ request }) => {
          const body = (await request.json()) as { path: string };
          seen.push({ operation: 'mkdir', path: body.path });
          return HttpResponse.json({});
        }
      ),
      http.post(
        `${BASE}/api/spaces/space-priv/files/rename`,
        async ({ request }) => {
          const body = (await request.json()) as {
            old_path: string;
            new_path: string;
          };
          seen.push({
            operation: 'mv',
            path: body.old_path,
            destination: body.new_path,
          });
          return HttpResponse.json({});
        }
      ),
      http.post(
        `${BASE}/api/spaces/space-priv/files/upload`,
        async ({ request }) => {
          const form = await request.formData();
          seen.push({ operation: 'upload', path: String(form.get('path')) });
          return HttpResponse.json({ path: 'docs/nested/uploads/upload.md' });
        }
      )
    );
    vi.stubEnv('DOCSYNC_BASE_URL', BASE);
    vi.stubEnv('DOCSYNC_API_TOKEN', TOKEN);
    Reflect.set(globalThis, '__VERSION__', 'test');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const run = async (args: string[]) => {
      const program = new Command().exitOverride();
      registerCommands(program);
      await program.parseAsync(args, { from: 'user' });
    };
    const stableChild = (path: string) =>
      `https://docz.example.com/s/yanhongkang/f/DIR12345/${path}`;
    const uploadDir = mkdtempSync(join(tmpdir(), 'docz-upload-'));
    const uploadFile = join(uploadDir, 'upload.md');
    writeFileSync(uploadFile, 'upload content');

    await run(['cat', stableChild('nested/read.md')]);
    await run(['write', stableChild('nested/write.md'), 'body', '--force']);
    await run(['mkdir', stableChild('nested/new-dir')]);
    await run(['mv', stableChild('nested/source.md'), 'archive/result.md']);
    await run(['upload', uploadFile, stableChild('nested/uploads')]);

    expect(seen).toEqual([
      { operation: 'cat', path: 'docs/nested/read.md' },
      { operation: 'write', path: 'docs/nested/write.md' },
      { operation: 'mkdir', path: 'docs/nested/new-dir' },
      {
        operation: 'mv',
        path: 'docs/nested/source.md',
        destination: 'archive/result.md',
      },
      { operation: 'upload', path: 'docs/nested/uploads' },
    ]);
    expect(seen.some((request) => request.path.startsWith('f/'))).toBe(false);
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

  it('resolves a directory stable child through the canonical resolver', async () => {
    const s = await resolveSpaceArg(
      client,
      'https://docz.zhenguanyu.com/s/yanhongkang/f/DIR12345/child.md'
    );
    expect(s.id).toBe('space-priv');
  });

  it('fails closed for a file stable link with a child suffix', async () => {
    await expect(
      resolveSpaceArg(
        client,
        'https://docz.zhenguanyu.com/s/yanhongkang/f/NNjrcj8c/child.md'
      )
    ).rejects.toThrow('requires a directory fileId');
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
