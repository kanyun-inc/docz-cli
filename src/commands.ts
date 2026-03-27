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
    .description('List files — docz ls <space>[:<path>]')
    .argument('<target...>')
    .action(async (args: string[]) => {
      const { space, path } = parseTarget(args);
      const client = getClient();
      const s = await client.resolveSpace(space);
      const entries = await client.ls(s.id, path);
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
    .description('Read file content — docz cat <space>:<path>')
    .argument('<target...>')
    .action(async (args: string[]) => {
      const { space, path } = parseTarget(args);
      if (!path) {
        console.error(
          'Error: file path is required. Usage: docz cat <space>:<path>'
        );
        process.exit(1);
      }
      const client = getClient();
      const s = await client.resolveSpace(space);
      const content = await client.cat(s.id, path);
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
    .description('Show change history — docz log <space>[:<path>]')
    .argument('<target...>')
    .action(async (args: string[]) => {
      const { space, path } = parseTarget(args);
      const client = getClient();
      const s = await client.resolveSpace(space);
      const logs = await client.log(s.id, path || undefined);
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
}
