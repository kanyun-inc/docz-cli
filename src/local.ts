import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, normalize, resolve, win32 } from 'node:path';
import type { Command } from 'commander';

export const DOCSYNC_CLIENT_DATA_DIR_ENV = 'DOCSYNC_CLIENT_DATA_DIR';

export interface LocalRootInfo {
  sync_root: string;
  exists: boolean;
  freshness: 'unknown';
  source: 'client_config';
}

interface DocSyncClientConfig {
  sync_dir?: unknown;
}

function normalizeConfiguredPath(value: string): string {
  if (win32.isAbsolute(value) && !isAbsolute(value)) {
    return win32.normalize(value);
  }
  return normalize(value);
}

export function getDocSyncClientDataDir(override?: string): string {
  const configured =
    override?.trim() || process.env[DOCSYNC_CLIENT_DATA_DIR_ENV]?.trim();
  return configured ? resolve(configured) : join(homedir(), '.docsync');
}

export function readLocalRootInfo(dataDir?: string): LocalRootInfo {
  const clientDataDir = getDocSyncClientDataDir(dataDir);
  const configPath = join(clientDataDir, 'config.json');
  if (!existsSync(configPath)) {
    throw new Error(`DocSync client config not found: ${configPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
  } catch {
    throw new Error(`Invalid DocSync client config: ${configPath}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid DocSync client config: ${configPath}`);
  }
  const config = parsed as DocSyncClientConfig;

  if (
    typeof config.sync_dir !== 'string' ||
    config.sync_dir.trim().length === 0
  ) {
    throw new Error('DocSync client config does not contain sync_dir');
  }
  if (!isAbsolute(config.sync_dir) && !win32.isAbsolute(config.sync_dir)) {
    throw new Error('DocSync client sync_dir must be an absolute path');
  }

  const syncRoot = normalizeConfiguredPath(config.sync_dir);
  let rootExists = false;
  try {
    rootExists = statSync(syncRoot).isDirectory();
  } catch {
    rootExists = false;
  }

  return {
    sync_root: syncRoot,
    exists: rootExists,
    freshness: 'unknown',
    source: 'client_config',
  };
}

export function registerLocalCommands(program: Command): void {
  const local = program
    .command('local')
    .description('Inspect local DocSync client configuration');

  local
    .command('root')
    .description('Print the configured local synchronization root')
    .option('--json', 'Output machine-readable JSON')
    .option(
      '--client-data-dir <path>',
      `DocSync client data directory (or ${DOCSYNC_CLIENT_DATA_DIR_ENV})`
    )
    .action((opts: { json?: boolean; clientDataDir?: string }) => {
      let info: LocalRootInfo;
      try {
        info = readLocalRootInfo(opts.clientDataDir);
      } catch (err) {
        console.error(
          `Error: ${err instanceof Error ? err.message : String(err)}`
        );
        process.exitCode = 1;
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(info));
      } else {
        console.log(info.sync_root);
      }
      if (!info.exists) {
        console.error(
          'Warning: configured DocSync synchronization root does not exist.'
        );
        process.exitCode = 2;
      }
    });
}
