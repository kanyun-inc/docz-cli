/**
 * CLI Commands
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { Command } from 'commander';
import { ConflictError, DocSyncClient } from './client.js';
import { getBaseUrl, getConfigPath, getToken, saveConfig } from './config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getClient(): DocSyncClient {
  const token = getToken();
  if (!token) {
    console.error(
      'Error: No token configured.\n' +
        'Run `docz login` or set DOCSYNC_API_TOKEN environment variable.'
    );
    process.exit(1);
  }
  return new DocSyncClient(getBaseUrl(), token);
}

/** Parse "space:path" or "space path" format */
export function parseTarget(args: string[]): { space: string; path: string } {
  if (args.length === 0) {
    console.error(
      'Error: space is required. Usage: docz <cmd> <space>[:<path>]'
    );
    process.exit(1);
  }
  const first = args[0];
  if (first.includes(':')) {
    const [space, ...rest] = first.split(':');
    return { space, path: rest.join(':') };
  }
  return { space: first, path: args.slice(1).join(' ') };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Short URL patterns: /s/{slug}/f/{fileId} or /s/{slug}
const SHORT_URL_RE = /\/s\/([^/]+)\/f\/([^/?\s#]+)/;
const SLUG_ONLY_RE = /\/s\/([^/?\s#]+)\/?(?:[?#].*)?$/;
// Share URL: /share/{token}
const SHARE_URL_RE = /\/share\/([^/?\s]+)/;

/**
 * Detect if input is a URL and resolve it to { spaceId, path }.
 * Returns null if not a URL.
 */
async function resolveUrl(
  client: DocSyncClient,
  input: string
): Promise<{ spaceId: string; path: string } | null> {
  // Match /s/{slug}/f/{fileId}
  const fileMatch = input.match(SHORT_URL_RE);
  if (fileMatch) {
    const [, slug, fileId] = fileMatch;
    const space = await resolveSlug(client, slug);
    const ref = await client.resolveFileRef(fileId);
    return { spaceId: space.id, path: ref.path };
  }
  // Match /s/{slug} (directory listing)
  const slugMatch = input.match(SLUG_ONLY_RE);
  if (slugMatch) {
    const [, slug] = slugMatch;
    const space = await resolveSlug(client, slug);
    return { spaceId: space.id, path: '' };
  }
  return null;
}

/** Resolve slug: try local spaces cache first, then API */
async function resolveSlug(
  client: DocSyncClient,
  slug: string
): Promise<{ id: string }> {
  try {
    const spaces = await client.listSpaces();
    const found = spaces.find((s) => s.slug === slug);
    if (found) return found;
  } catch {
    // fall through to by-slug API
  }
  return client.resolveBySlug(slug);
}

/**
 * Resolve target: if it's a short URL, resolve it; otherwise use parseTarget + resolveSpace.
 */
export async function resolveTarget(
  client: DocSyncClient,
  args: string[]
): Promise<{ spaceId: string; path: string }> {
  const first = args[0];
  if (first && (first.startsWith('http://') || first.startsWith('https://'))) {
    const result = await resolveUrl(client, first);
    if (result) return result;
    throw new Error(
      `Unrecognized DocSync URL: ${first}\nExpected format: https://docz.zhenguanyu.com/s/{slug}/f/{fileId} or /s/{slug}`
    );
  }
  const { space, path } = parseTarget(args);
  const s = await client.resolveSpace(space);
  return { spaceId: s.id, path };
}

const SLUG_FROM_URL_RE = /\/s\/([^/?\s#]+)/;

/**
 * Resolve a space argument that may be a name, UUID, or short URL.
 * Extracts slug from URL and resolves to space; throws on unrecognized URL.
 */
export async function resolveSpaceArg(
  client: DocSyncClient,
  input: string
): Promise<{ id: string }> {
  if (input.startsWith('http://') || input.startsWith('https://')) {
    const m = input.match(SLUG_FROM_URL_RE);
    if (m) return resolveSlug(client, m[1]);
    throw new Error(
      `Unrecognized DocSync URL: ${input}\nExpected format: https://docz.zhenguanyu.com/s/{slug}[/f/{fileId}]`
    );
  }
  return client.resolveSpace(input);
}

/** Parse relative duration (7d, 24h, 30d) to RFC3339 */
export function parseExpires(value: string): string {
  const match = value.match(/^(\d+)([dh])$/);
  if (!match)
    throw new Error(
      `Invalid expires format: "${value}". Use e.g. 7d, 24h, 30d`
    );
  const [, num, unit] = match;
  const ms = unit === 'd' ? Number(num) * 86400000 : Number(num) * 3600000;
  return new Date(Date.now() + ms).toISOString();
}

/** Extract share token from URL or return as-is */
function extractShareToken(input: string): string {
  const m = input.match(SHARE_URL_RE);
  if (m) return m[1];
  return input;
}

/** Read all of stdin into a string */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

const MAX_SAVE_SIZE = 2 * 1024 * 1024; // 2MB

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export function registerCommands(program: Command): void {
  // --- login ---
  program
    .command('login')
    .description('Configure DocSync credentials')
    .option('-u, --url <url>', 'DocSync server URL')
    .option('-t, --token <token>', 'API token')
    .action(async (opts) => {
      const url = opts.url ?? getBaseUrl();
      const token = opts.token;
      if (!token) {
        console.error(
          'Error: --token is required.\n' +
            'Get one at: ' +
            url +
            ' → Settings → API Tokens'
        );
        process.exit(1);
      }
      const client = new DocSyncClient(url, token);
      try {
        const user = await client.me();
        saveConfig(url, token);
        console.log(`Logged in as ${user.name} (${user.email})`);
        console.log(`Config saved to ${getConfigPath()}`);
      } catch (err) {
        console.error(
          `Error: ${err instanceof Error ? err.message : String(err)}`
        );
        process.exit(1);
      }
    });

  // --- whoami ---
  program
    .command('whoami')
    .description('Show current user')
    .action(async () => {
      const client = getClient();
      const user = await client.me();
      console.log(`${user.name} (${user.email})`);
    });

  // --- spaces ---
  program
    .command('spaces')
    .description('List all accessible spaces')
    .action(async () => {
      const client = getClient();
      const spaces = await client.listSpaces();
      for (const s of spaces) {
        const tag = s.is_private ? 'private' : 'team';
        console.log(`${s.name}\t${tag}\t${s.member_count} members\t${s.id}`);
      }
    });

  // --- ls ---
  program
    .command('ls')
    .description('List files — docz ls <space>[:<path>] or <url>')
    .argument('<target...>')
    .option('-R, --recursive', 'Recursively list all files')
    .action(async (args: string[], opts: { recursive?: boolean }) => {
      const client = getClient();
      const { spaceId, path } = await resolveTarget(client, args);
      const entries = opts.recursive
        ? await client.treeFull(spaceId)
        : await client.ls(spaceId, path);
      if (entries.length === 0) {
        console.log('(empty)');
        return;
      }
      for (const e of entries) {
        if (e.type === 'tree') {
          console.log(`${e.name}/`);
        } else {
          console.log(`${e.name}\t${formatSize(e.size)}`);
        }
      }
    });

  // --- cat ---
  program
    .command('cat')
    .description('Read file content — docz cat <space>:<path> or <url>')
    .argument('<target...>')
    .option('--ref', 'Also output Git ref to stderr')
    .action(async (args: string[], opts: { ref?: boolean }) => {
      const client = getClient();
      const { spaceId, path } = await resolveTarget(client, args);
      if (!path) {
        console.error(
          'Error: file path is required. Usage: docz cat <space>:<path>'
        );
        process.exit(1);
      }
      if (opts.ref) {
        const result = await client.catWithRef(spaceId, path);
        console.error(`ref: ${result.ref}`);
        process.stdout.write(result.content);
      } else {
        const content = await client.cat(spaceId, path);
        process.stdout.write(content);
      }
    });

  // --- upload ---
  program
    .command('upload')
    .description(
      'Upload file — docz upload <local-file> <space>[:<dir>] or <url>'
    )
    .argument('<file>', 'Local file to upload')
    .argument('<target...>')
    .action(async (file: string, args: string[]) => {
      const client = getClient();
      const { spaceId, path: dir } = await resolveTarget(client, args);
      const content = readFileSync(file);
      const filename = basename(file);
      const targetDir = dir || '';
      const result = await client.upload(spaceId, targetDir, filename, content);
      console.log(`Uploaded: ${result.path}`);
    });

  // --- write ---
  program
    .command('write')
    .description(
      'Write content to file — docz write <space>:<path> <content> or <url> <content>'
    )
    .argument('<target>', 'space:dir/filename.md or short URL')
    .argument('<content>', 'File content (or - for stdin)')
    .option('--force', 'Skip conflict detection')
    .option('-m, --message <msg>', 'Custom commit message')
    .action(
      async (
        target: string,
        content: string,
        opts: { force?: boolean; message?: string }
      ) => {
        const client = getClient();
        const { spaceId, path } = await resolveTarget(client, [target]);
        if (!path) {
          console.error(
            'Error: path is required. Usage: docz write <space>:<dir/filename> <content>'
          );
          process.exit(1);
        }
        const body = content === '-' ? await readStdin() : content;

        if (Buffer.byteLength(body, 'utf-8') > MAX_SAVE_SIZE) {
          console.error(
            'Error: content exceeds 2MB limit. Use `docz upload` for large files.'
          );
          process.exit(1);
        }

        let baseRef: string | undefined;
        if (!opts.force) {
          try {
            const existing = await client.catWithRef(spaceId, path);
            baseRef = existing.ref;
          } catch (err) {
            const msg = err instanceof Error ? err.message : '';
            if (!msg.includes('404')) throw err;
          }
        }

        try {
          const result = await client.save(spaceId, path, body, {
            baseRef,
            message: opts.message,
          });
          console.log(`Written: ${result.path} (ref: ${result.ref})`);
        } catch (err) {
          if (err instanceof ConflictError) {
            console.error(
              'Error: file was modified by someone else. Please re-read the latest content and try again.'
            );
            process.exit(1);
          }
          throw err;
        }
      }
    );

  // --- mkdir ---
  program
    .command('mkdir')
    .description('Create folder — docz mkdir <space>:<path> or <url>')
    .argument('<target...>')
    .action(async (args: string[]) => {
      const client = getClient();
      const { spaceId, path } = await resolveTarget(client, args);
      if (!path) {
        console.error('Error: path is required.');
        process.exit(1);
      }
      await client.mkdir(spaceId, path);
      console.log(`Created: ${path}`);
    });

  // --- rm ---
  program
    .command('rm')
    .description('Delete file/folder — docz rm <space>:<path> or <url>')
    .argument('<target...>')
    .action(async (args: string[]) => {
      const client = getClient();
      const { spaceId, path } = await resolveTarget(client, args);
      if (!path) {
        console.error('Error: path is required.');
        process.exit(1);
      }
      await client.rm(spaceId, path);
      console.log(`Deleted: ${path} (recoverable from trash for 30 days)`);
    });

  // --- mv ---
  program
    .command('mv')
    .description('Rename/move — docz mv <space>:<from> <to> or <url> <to>')
    .argument('<target>', 'space:old-path or short URL')
    .argument('<to>', 'new-path')
    .action(async (target: string, to: string) => {
      const client = getClient();
      const { spaceId, path: from } = await resolveTarget(client, [target]);
      if (!from) {
        console.error('Error: source path is required.');
        process.exit(1);
      }
      await client.mv(spaceId, from, to);
      console.log(`Moved: ${from} → ${to}`);
    });

  // --- log ---
  program
    .command('log')
    .description('Show change history — docz log <space>[:<path>] or <url>')
    .argument('<target...>')
    .action(async (args: string[]) => {
      const client = getClient();
      const { spaceId, path } = await resolveTarget(client, args);
      const logs = await client.log(spaceId, path || undefined);
      if (logs.length === 0) {
        console.log('No history.');
        return;
      }
      for (const l of logs) {
        console.log(`${l.hash}  ${l.date}  ${l.message}`);
      }
    });

  // --- rollback ---
  program
    .command('rollback')
    .description(
      'Rollback file to a previous version — docz rollback <space>:<path> <commit> or <url> <commit>'
    )
    .argument('<target>', 'space:path or short URL')
    .argument('<commit>', 'Commit hash to rollback to')
    .action(async (target: string, commit: string) => {
      const client = getClient();
      const { spaceId, path } = await resolveTarget(client, [target]);
      if (!path) {
        console.error('Error: file path is required.');
        process.exit(1);
      }
      await client.rollback(spaceId, path, commit);
      console.log(`Rolled back: ${path} → ${commit.substring(0, 7)}`);
    });

  // --- trash ---
  program
    .command('trash')
    .description('Show deleted files — docz trash <space>')
    .argument('<space>')
    .action(async (spaceName: string) => {
      const client = getClient();
      const s = await resolveSpaceArg(client, spaceName);
      const items = await client.trash(s.id);
      if (items.length === 0) {
        console.log('Trash is empty.');
        return;
      }
      for (const t of items) {
        console.log(
          `${t.path}\tdeleted ${t.deleted_at}\t${t.commit.substring(0, 7)}`
        );
      }
    });

  // --- restore ---
  program
    .command('restore')
    .description(
      'Restore file from trash — docz restore <space>:<path> <commit> or <url> <commit>'
    )
    .argument('<target>', 'space:path or short URL')
    .argument('<commit>', 'Commit hash from trash listing')
    .action(async (target: string, commit: string) => {
      const client = getClient();
      const { spaceId, path } = await resolveTarget(client, [target]);
      if (!path) {
        console.error('Error: path is required.');
        process.exit(1);
      }
      await client.restore(spaceId, path, commit);
      console.log(`Restored: ${path}`);
    });

  // --- comment ---
  const comment = program
    .command('comment')
    .description('Manage file comments');

  comment
    .command('list')
    .description('List comments — docz comment list <space>:<path>')
    .argument('<target...>')
    .action(async (args: string[]) => {
      const client = getClient();
      const { spaceId, path } = await resolveTarget(client, args);
      if (!path) {
        console.error('Error: file path is required.');
        process.exit(1);
      }
      const comments = await client.listComments(spaceId, path);
      if (comments.length === 0) {
        console.log('No comments.');
        return;
      }
      for (const c of comments) {
        const status = c.is_closed ? ' [closed]' : '';
        console.log(`#${c.id} ${c.user_name} (${c.created_at})${status}`);
        console.log(`  ${c.content}`);
        for (const r of c.replies) {
          console.log(`    → ${r.user_name}: ${r.content}`);
        }
      }
    });

  comment
    .command('add')
    .description(
      'Add comment — docz comment add <space>:<path> <content> or <url> <content>'
    )
    .argument('<target>', 'space:path or short URL')
    .argument('<content>', 'Comment text (or - for stdin)')
    .action(async (target: string, content: string) => {
      const client = getClient();
      const { spaceId, path } = await resolveTarget(client, [target]);
      if (!path) {
        console.error('Error: file path is required.');
        process.exit(1);
      }
      const body = content === '-' ? await readStdin() : content;
      const c = await client.createComment(spaceId, path, body);
      console.log(`Comment #${c.id} created.`);
    });

  comment
    .command('reply')
    .description(
      'Reply to comment — docz comment reply <space> <commentId> <content>'
    )
    .argument('<space>')
    .argument('<commentId>')
    .argument('<content>', 'Reply text (or - for stdin)')
    .action(async (spaceName: string, commentId: string, content: string) => {
      const client = getClient();
      const s = await resolveSpaceArg(client, spaceName);
      const body = content === '-' ? await readStdin() : content;
      const r = await client.replyComment(s.id, Number(commentId), body);
      console.log(`Reply #${r.id} created.`);
    });

  comment
    .command('close')
    .description('Close comment — docz comment close <space> <commentId>')
    .argument('<space>')
    .argument('<commentId>')
    .action(async (spaceName: string, commentId: string) => {
      const client = getClient();
      const s = await resolveSpaceArg(client, spaceName);
      await client.closeComment(s.id, Number(commentId));
      console.log(`Comment #${commentId} closed.`);
    });

  comment
    .command('rm')
    .description('Delete comment — docz comment rm <space> <commentId>')
    .argument('<space>')
    .argument('<commentId>')
    .action(async (spaceName: string, commentId: string) => {
      const client = getClient();
      const s = await resolveSpaceArg(client, spaceName);
      await client.deleteComment(s.id, Number(commentId));
      console.log(`Comment #${commentId} deleted.`);
    });

  // --- share ---
  const share = program.command('share').description('Manage share links');

  share
    .command('create')
    .description(
      'Create share link — docz share create <space>:<path> or <url>'
    )
    .argument('<target>', 'space:path or short URL')
    .option('--expires <duration>', 'Expiry duration (e.g. 7d, 24h)')
    .option('--users <emails>', 'Comma-separated user emails or IDs')
    .option('--groups <ids>', 'Comma-separated group IDs')
    .action(
      async (
        target: string,
        opts: { expires?: string; users?: string; groups?: string }
      ) => {
        const client = getClient();
        const { spaceId, path } = await resolveTarget(client, [target]);
        if (!path) {
          console.error(
            'Error: file path is required. Usage: docz share create <space>:<path>'
          );
          process.exit(1);
        }
        const apiOpts: {
          expiresAt?: string;
          userIds?: string[];
          groupIds?: string[];
        } = {};
        if (opts.expires) apiOpts.expiresAt = parseExpires(opts.expires);
        if (opts.users)
          apiOpts.userIds = opts.users.split(',').map((s) => s.trim());
        if (opts.groups)
          apiOpts.groupIds = opts.groups.split(',').map((s) => s.trim());
        const link = await client.createShareLink(spaceId, path, apiOpts);
        const baseUrl = getBaseUrl();
        console.log('Created share link:');
        console.log(`  id:      ${link.id}`);
        console.log(`  token:   ${link.token}`);
        console.log(`  url:     ${baseUrl}/share/${link.token}`);
        console.log(`  expires: ${link.expires_at ?? 'never'}`);
        if (link.user_ids?.length)
          console.log(`  users:   ${link.user_ids.join(', ')}`);
        if (link.group_ids?.length)
          console.log(`  groups:  ${link.group_ids.length}`);
      }
    );

  share
    .command('list')
    .description('List share links — docz share list <space>')
    .argument('<space>')
    .option('--file <path>', 'Filter by file path')
    .action(async (spaceName: string, opts: { file?: string }) => {
      const client = getClient();
      const s = await resolveSpaceArg(client, spaceName);
      const links = await client.listShareLinks(s.id, opts.file);
      if (links.length === 0) {
        console.log('No share links.');
        return;
      }
      for (const l of links) {
        const expires = l.expires_at ?? 'never';
        const creator = l.created_by_name ?? l.created_by_email ?? l.created_by;
        console.log(
          `${l.id}\t${l.token}\t${l.file_path}\t${expires}\t${creator}`
        );
      }
    });

  share
    .command('update')
    .description('Update share link — docz share update <space> <link-id>')
    .argument('<space>')
    .argument('<linkId>')
    .option('--expires <duration>', 'New expiry duration (e.g. 30d)')
    .option('--users <emails>', 'Comma-separated user emails or IDs')
    .option('--groups <ids>', 'Comma-separated group IDs')
    .action(
      async (
        spaceName: string,
        linkId: string,
        opts: { expires?: string; users?: string; groups?: string }
      ) => {
        const client = getClient();
        const s = await resolveSpaceArg(client, spaceName);
        const apiOpts: {
          expiresAt?: string;
          userIds?: string[];
          groupIds?: string[];
        } = {};
        if (opts.expires) apiOpts.expiresAt = parseExpires(opts.expires);
        if (opts.users)
          apiOpts.userIds = opts.users.split(',').map((s) => s.trim());
        if (opts.groups)
          apiOpts.groupIds = opts.groups.split(',').map((s) => s.trim());
        await client.updateShareLink(s.id, linkId, apiOpts);
        console.log(`Updated share link: ${linkId}`);
      }
    );

  share
    .command('cat')
    .description('Read shared file — docz share cat <token-or-url>')
    .argument('<token>', 'Share token or full URL')
    .option('--raw', 'Output raw content only')
    .action(async (tokenArg: string, opts: { raw?: boolean }) => {
      const client = getClient();
      const token = extractShareToken(tokenArg);
      if (!opts.raw) {
        try {
          const info = await client.getSharedFileInfo(token);
          console.log(`File: ${info.file_path} (${info.space_name})`);
          console.log(
            `Shared by: ${info.created_by_name} | Expires: ${info.expires_at ?? 'never'}`
          );
          console.log('---');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes('404')) {
            console.error(`Warning: failed to fetch share info: ${msg}`);
          }
        }
      }
      const content = await client.getSharedFile(token);
      process.stdout.write(content);
    });

  share
    .command('info')
    .description('Show share link info — docz share info <token-or-url>')
    .argument('<token>', 'Share token or full URL')
    .action(async (tokenArg: string) => {
      const client = getClient();
      const token = extractShareToken(tokenArg);
      const info = await client.getSharedFileInfo(token);
      console.log(`File:       ${info.file_path}`);
      console.log(`Space:      ${info.space_name}`);
      console.log(`Shared by:  ${info.created_by_name}`);
      console.log(`Expires:    ${info.expires_at ?? 'never'}`);
    });

  share
    .command('rm')
    .description('Delete share link — docz share rm <space> <link-id>')
    .argument('<space>')
    .argument('<linkId>')
    .action(async (spaceName: string, linkId: string) => {
      const client = getClient();
      const s = await resolveSpaceArg(client, spaceName);
      await client.deleteShareLink(s.id, linkId);
      console.log(`Deleted share link: ${linkId}`);
    });

  // --- shortlink ---
  program
    .command('shortlink')
    .description('Get short URL — docz shortlink <space>:<path> or <url>')
    .argument('<target...>')
    .action(async (args: string[]) => {
      const client = getClient();
      const { spaceId, path } = await resolveTarget(client, args);
      if (!path) {
        console.error(
          'Error: file path is required. Usage: docz shortlink <space>:<path>'
        );
        process.exit(1);
      }
      const ref = await client.getFileRef(spaceId, path);
      console.log(ref.url);
    });

  // --- diff ---
  program
    .command('diff')
    .description(
      'Show changes — docz diff <space>[:<path>] <commit> [<from>] or <url> <commit> [<from>]'
    )
    .argument('<target>', 'space or space:path or short URL')
    .argument('<to>', 'Commit hash')
    .argument('[from]', 'From commit hash (default: to^)')
    .action(async (target: string, to: string, from?: string) => {
      const client = getClient();
      const { spaceId, path } = await resolveTarget(client, [target]);
      if (path) {
        const result = await client.diffFile(spaceId, path, to, from);
        if (result.diff) {
          process.stdout.write(result.diff);
        } else {
          console.log('No changes.');
        }
      } else {
        const result = await client.diffSummary(spaceId, to, from);
        if (result.files.length === 0) {
          console.log('No changes.');
          return;
        }
        for (const f of result.files) {
          console.log(`${f.status}  ${f.path}`);
        }
      }
    });
}
