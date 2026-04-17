/**
 * CLI Commands
 */

import { readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { Command } from 'commander';
import { DocSyncClient } from './client.js';
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
function parseTarget(args: string[]): { space: string; path: string } {
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
const SHORT_URL_RE = /\/s\/([^/]+)\/f\/([^/?\s]+)/;
const SLUG_ONLY_RE = /\/s\/([^/?\s]+)\/?$/;
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
    const found = spaces.find(
      (s) => (s as unknown as Record<string, unknown>).slug === slug
    );
    if (found) return found;
  } catch {
    // fall through to by-slug API
  }
  return client.resolveBySlug(slug);
}

/**
 * Resolve target: if it's a short URL, resolve it; otherwise use parseTarget + resolveSpace.
 */
async function resolveTarget(
  client: DocSyncClient,
  args: string[]
): Promise<{ spaceId: string; path: string }> {
  const first = args[0];
  if (first && (first.startsWith('http://') || first.startsWith('https://'))) {
    const result = await resolveUrl(client, first);
    if (result) return result;
  }
  const { space, path } = parseTarget(args);
  const s = await client.resolveSpace(space);
  return { spaceId: s.id, path };
}

/** Parse relative duration (7d, 24h, 30d) to RFC3339 */
export function parseExpires(value: string): string {
  const match = value.match(/^(\d+)([dh])$/);
  if (!match) throw new Error(`Invalid expires format: "${value}". Use e.g. 7d, 24h, 30d`);
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
      // Verify token
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
    .action(async (args: string[]) => {
      const client = getClient();
      const { spaceId, path } = await resolveTarget(client, args);
      const entries = await client.ls(spaceId, path);
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
    .action(async (args: string[]) => {
      const client = getClient();
      const { spaceId, path } = await resolveTarget(client, args);
      if (!path) {
        console.error(
          'Error: file path is required. Usage: docz cat <space>:<path>'
        );
        process.exit(1);
      }
      const content = await client.cat(spaceId, path);
      process.stdout.write(content);
    });

  // --- upload ---
  program
    .command('upload')
    .description('Upload file — docz upload <local-file> <space>[:<dir>]')
    .argument('<file>', 'Local file to upload')
    .argument('<target...>')
    .action(async (file: string, args: string[]) => {
      const { space, path: dir } = parseTarget(args);
      const client = getClient();
      const s = await client.resolveSpace(space);
      const content = readFileSync(file);
      const filename = basename(file);
      const targetDir = dir || '';
      const result = await client.upload(s.id, targetDir, filename, content);
      console.log(`Uploaded: ${result.path}`);
    });

  // --- write ---
  program
    .command('write')
    .description('Write content to file — docz write <space>:<path> <content>')
    .argument('<target>', 'space:dir/filename.md')
    .argument('<content>', 'File content (or - for stdin)')
    .action(async (target: string, content: string) => {
      const { space, path } = parseTarget([target]);
      if (!path) {
        console.error(
          'Error: path is required. Usage: docz write <space>:<dir/filename> <content>'
        );
        process.exit(1);
      }
      const client = getClient();
      const s = await client.resolveSpace(space);
      const filename = basename(path);
      const dir = dirname(path);
      let body: string;
      if (content === '-') {
        // Read from stdin
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk as Buffer);
        }
        body = Buffer.concat(chunks).toString('utf-8');
      } else {
        body = content;
      }
      const result = await client.upload(
        s.id,
        dir === '.' ? '' : dir,
        filename,
        body
      );
      console.log(`Written: ${result.path}`);
    });

  // --- mkdir ---
  program
    .command('mkdir')
    .description('Create folder — docz mkdir <space>:<path>')
    .argument('<target...>')
    .action(async (args: string[]) => {
      const { space, path } = parseTarget(args);
      if (!path) {
        console.error('Error: path is required.');
        process.exit(1);
      }
      const client = getClient();
      const s = await client.resolveSpace(space);
      await client.mkdir(s.id, path);
      console.log(`Created: ${path}`);
    });

  // --- rm ---
  program
    .command('rm')
    .description('Delete file/folder — docz rm <space>:<path>')
    .argument('<target...>')
    .action(async (args: string[]) => {
      const { space, path } = parseTarget(args);
      if (!path) {
        console.error('Error: path is required.');
        process.exit(1);
      }
      const client = getClient();
      const s = await client.resolveSpace(space);
      await client.rm(s.id, path);
      console.log(`Deleted: ${path} (recoverable from trash for 30 days)`);
    });

  // --- mv ---
  program
    .command('mv')
    .description('Rename/move — docz mv <space>:<from> <to>')
    .argument('<target>', 'space:old-path')
    .argument('<to>', 'new-path')
    .action(async (target: string, to: string) => {
      const { space, path: from } = parseTarget([target]);
      if (!from) {
        console.error('Error: source path is required.');
        process.exit(1);
      }
      const client = getClient();
      const s = await client.resolveSpace(space);
      await client.mv(s.id, from, to);
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
        console.log(`${l.hash.substring(0, 7)}  ${l.date}  ${l.message}`);
      }
    });

  // --- trash ---
  program
    .command('trash')
    .description('Show deleted files — docz trash <space>')
    .argument('<space>')
    .action(async (spaceName: string) => {
      const client = getClient();
      const s = await client.resolveSpace(spaceName);
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

  // --- share ---
  const share = program.command('share').description('Manage share links');

  share
    .command('create')
    .description('Create share link — docz share create <space>:<path>')
    .argument('<target>', 'space:path')
    .option('--expires <duration>', 'Expiry duration (e.g. 7d, 24h)')
    .option('--users <emails>', 'Comma-separated user emails or IDs')
    .option('--groups <ids>', 'Comma-separated group IDs')
    .action(async (target: string, opts: { expires?: string; users?: string; groups?: string }) => {
      const { space, path } = parseTarget([target]);
      if (!path) {
        console.error('Error: file path is required. Usage: docz share create <space>:<path>');
        process.exit(1);
      }
      const client = getClient();
      const s = await client.resolveSpace(space);
      const apiOpts: { expiresAt?: string; userIds?: string[]; groupIds?: string[] } = {};
      if (opts.expires) apiOpts.expiresAt = parseExpires(opts.expires);
      if (opts.users) apiOpts.userIds = opts.users.split(',').map((s) => s.trim());
      if (opts.groups) apiOpts.groupIds = opts.groups.split(',').map((s) => s.trim());
      const link = await client.createShareLink(s.id, path, apiOpts);
      const baseUrl = getBaseUrl();
      console.log(`Created share link:`);
      console.log(`  id:      ${link.id}`);
      console.log(`  token:   ${link.token}`);
      console.log(`  url:     ${baseUrl}/share/${link.token}`);
      console.log(`  expires: ${link.expires_at ?? 'never'}`);
      if (link.user_ids?.length) console.log(`  users:   ${link.user_ids.join(', ')}`);
      if (link.group_ids?.length) console.log(`  groups:  ${link.group_ids.length}`);
    });

  share
    .command('list')
    .description('List share links — docz share list <space>')
    .argument('<space>')
    .option('--file <path>', 'Filter by file path')
    .action(async (spaceName: string, opts: { file?: string }) => {
      const client = getClient();
      const s = await client.resolveSpace(spaceName);
      const links = await client.listShareLinks(s.id, opts.file);
      if (links.length === 0) {
        console.log('No share links.');
        return;
      }
      for (const l of links) {
        const expires = l.expires_at ?? 'never';
        const creator = l.created_by_name ?? l.created_by_email ?? l.created_by;
        console.log(`${l.id}\t${l.token}\t${l.file_path}\t${expires}\t${creator}`);
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
    .action(async (spaceName: string, linkId: string, opts: { expires?: string; users?: string; groups?: string }) => {
      const client = getClient();
      const s = await client.resolveSpace(spaceName);
      const apiOpts: { expiresAt?: string; userIds?: string[]; groupIds?: string[] } = {};
      if (opts.expires) apiOpts.expiresAt = parseExpires(opts.expires);
      if (opts.users) apiOpts.userIds = opts.users.split(',').map((s) => s.trim());
      if (opts.groups) apiOpts.groupIds = opts.groups.split(',').map((s) => s.trim());
      await client.updateShareLink(s.id, linkId, apiOpts);
      console.log(`Updated share link: ${linkId}`);
    });

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
          console.log(`Shared by: ${info.created_by_name} | Expires: ${info.expires_at ?? 'never'}`);
          console.log('---');
        } catch {
          // info endpoint may fail, still show content
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
      const s = await client.resolveSpace(spaceName);
      await client.deleteShareLink(s.id, linkId);
      console.log(`Deleted share link: ${linkId}`);
    });

  // --- diff ---
  program
    .command('diff')
    .description('Show changes — docz diff <space>[:<path>] <commit> [<from>]')
    .argument('<target>', 'space or space:path')
    .argument('<to>', 'Commit hash')
    .argument('[from]', 'From commit hash (default: to^)')
    .action(async (target: string, to: string, from?: string) => {
      const client = getClient();
      const { space, path } = parseTarget([target]);
      const s = await client.resolveSpace(space);
      if (path) {
        const result = await client.diffFile(s.id, path, to, from);
        if (result.diff) {
          process.stdout.write(result.diff);
        } else {
          console.log('No changes.');
        }
      } else {
        const result = await client.diffSummary(s.id, to, from);
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
