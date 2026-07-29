import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DOCSYNC_CLIENT_DATA_DIR_ENV,
  getDocSyncClientDataDir,
  readLocalRootInfo,
  registerLocalCommands,
} from './local.js';

const tempDirs: string[] = [];
const originalClientDataDir = process.env[DOCSYNC_CLIENT_DATA_DIR_ENV];
const originalExitCode = process.exitCode;

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'docz-local-root-'));
  tempDirs.push(dir);
  return dir;
}

function writeClientConfig(dataDir: string, syncDir: unknown): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, 'config.json'),
    JSON.stringify({ sync_dir: syncDir, token: 'must-not-be-returned' })
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = originalExitCode;
  if (originalClientDataDir === undefined) {
    delete process.env[DOCSYNC_CLIENT_DATA_DIR_ENV];
  } else {
    process.env[DOCSYNC_CLIENT_DATA_DIR_ENV] = originalClientDataDir;
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('getDocSyncClientDataDir', () => {
  it('prefers an explicit directory over the environment', () => {
    process.env[DOCSYNC_CLIENT_DATA_DIR_ENV] = '/environment/client-data';
    expect(getDocSyncClientDataDir('/explicit/client-data')).toBe(
      resolve('/explicit/client-data')
    );
  });

  it('uses DOCSYNC_CLIENT_DATA_DIR when provided', () => {
    const dataDir = makeTempDir();
    process.env[DOCSYNC_CLIENT_DATA_DIR_ENV] = dataDir;
    expect(getDocSyncClientDataDir()).toBe(resolve(dataDir));
  });
});

describe('local root command', () => {
  it('prints parseable JSON without requiring Docz authentication', async () => {
    const dataDir = makeTempDir();
    const syncDir = makeTempDir();
    writeClientConfig(dataDir, syncDir);
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((value) =>
      stdout.push(String(value))
    );
    vi.spyOn(console, 'error').mockImplementation((value) =>
      stderr.push(String(value))
    );
    const program = new Command();
    registerLocalCommands(program);

    await program.parseAsync([
      'node',
      'docz',
      'local',
      'root',
      '--json',
      '--client-data-dir',
      dataDir,
    ]);

    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout.join('\n'))).toEqual({
      sync_root: syncDir,
      exists: true,
      freshness: 'unknown',
      source: 'client_config',
    });
    expect(stdout.join('\n')).not.toContain('must-not-be-returned');
  });

  it('returns exit code 2 while still printing a configured missing root', async () => {
    const dataDir = makeTempDir();
    const syncDir = join(dataDir, 'missing-root');
    writeClientConfig(dataDir, syncDir);
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((value) =>
      stdout.push(String(value))
    );
    vi.spyOn(console, 'error').mockImplementation((value) =>
      stderr.push(String(value))
    );
    const program = new Command();
    registerLocalCommands(program);

    await program.parseAsync([
      'node',
      'docz',
      'local',
      'root',
      '--client-data-dir',
      dataDir,
    ]);

    expect(stdout).toEqual([syncDir]);
    expect(stderr.join('\n')).toContain('does not exist');
    expect(process.exitCode).toBe(2);
  });
});

describe('readLocalRootInfo', () => {
  it('returns an existing Unicode synchronization root without exposing config secrets', () => {
    const dataDir = makeTempDir();
    const syncDir = join(makeTempDir(), '知识库 同步');
    mkdirSync(syncDir);
    writeClientConfig(dataDir, syncDir);

    expect(readLocalRootInfo(dataDir)).toEqual({
      sync_root: syncDir,
      exists: true,
      freshness: 'unknown',
      source: 'client_config',
    });
  });

  it('returns the configured path with exists=false when the root is absent', () => {
    const dataDir = makeTempDir();
    const syncDir = join(dataDir, 'missing-sync-root');
    writeClientConfig(dataDir, syncDir);

    expect(readLocalRootInfo(dataDir)).toEqual({
      sync_root: syncDir,
      exists: false,
      freshness: 'unknown',
      source: 'client_config',
    });
  });

  it('preserves and normalizes an absolute Windows path', () => {
    const dataDir = makeTempDir();
    const windowsSyncDir = 'C:\\Users\\测试\\Docz';
    writeClientConfig(dataDir, windowsSyncDir);

    expect(readLocalRootInfo(dataDir)).toMatchObject({
      sync_root: windowsSyncDir,
      exists: false,
    });
  });

  it('accepts a Windows UNC synchronization root', () => {
    const dataDir = makeTempDir();
    const uncSyncDir = '\\\\server\\share\\Docz';
    writeClientConfig(dataDir, uncSyncDir);

    expect(readLocalRootInfo(dataDir)).toMatchObject({
      sync_root: uncSyncDir,
      exists: false,
    });
  });

  it('rejects a missing, malformed, or incomplete config', () => {
    const missingDir = makeTempDir();
    expect(() => readLocalRootInfo(missingDir)).toThrow(
      'DocSync client config not found'
    );

    const malformedDir = makeTempDir();
    writeFileSync(join(malformedDir, 'config.json'), '{');
    expect(() => readLocalRootInfo(malformedDir)).toThrow(
      'Invalid DocSync client config'
    );

    const nonObjectDir = makeTempDir();
    writeFileSync(join(nonObjectDir, 'config.json'), 'null');
    expect(() => readLocalRootInfo(nonObjectDir)).toThrow(
      'Invalid DocSync client config'
    );

    const incompleteDir = makeTempDir();
    writeFileSync(join(incompleteDir, 'config.json'), '{}');
    expect(() => readLocalRootInfo(incompleteDir)).toThrow(
      'does not contain sync_dir'
    );
  });

  it('rejects a relative synchronization root', () => {
    const dataDir = makeTempDir();
    writeClientConfig(dataDir, 'relative/Docz');
    expect(() => readLocalRootInfo(dataDir)).toThrow(
      'sync_dir must be an absolute path'
    );
  });
});
