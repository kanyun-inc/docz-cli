import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCLI } from './cli.js';

const originalExitCode = process.exitCode;

type Invocation = {
  logs: string[];
  stdout: string;
  stderr: string;
  exitCode: string | number | null | undefined;
};

beforeEach(() => {
  vi.stubEnv('DOCSYNC_API_TOKEN', 'fake-token');
  vi.stubEnv('DOCSYNC_BASE_URL', 'https://docz.invalid');
  Reflect.set(globalThis, '__VERSION__', 'test');
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  Reflect.deleteProperty(globalThis, '__VERSION__');
  process.exitCode = originalExitCode;
});

async function invoke(argv: string[]): Promise<Invocation> {
  const logs: string[] = [];
  let stdout = '';
  let stderr = '';
  vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
    logs.push(String(message));
  });
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });

  await runCLI(argv, 'test');
  return { logs, stdout, stderr, exitCode: process.exitCode };
}

function expectSheetArgumentFailure(result: Invocation): void {
  expect(result.logs).toHaveLength(1);
  expect(JSON.parse(result.logs[0])).toMatchObject({
    outcome: 'FAILED',
    phase: 'validate',
    unit_id: null,
    identity_resolved: false,
    collaboration_status: 'NOT_STARTED',
    failure_code: 'sheet_arguments_invalid',
  });
  expect(result.stderr).toBe('');
  expect(result.exitCode).toBe(1);
}

describe('CLI entrypoint contract', () => {
  it.each([
    [
      'get option without value',
      ['sheet', 'get', 'target', '--json', '--range'],
    ],
    [
      '--json consumed as a value',
      ['sheet', 'get', 'target', '--range', '--json'],
    ],
    [
      'set option without value',
      [
        'sheet',
        'set',
        'target',
        '--range',
        'Sheet1!A1',
        '--values-json',
        '--json',
      ],
    ],
    [
      'unknown sensitive option',
      [
        'sheet',
        'get',
        'target',
        '--range',
        'Sheet1!A1',
        '--json',
        '--secret-token',
        'never-print',
      ],
    ],
    [
      'extra argument',
      [
        'sheet',
        'get',
        'target',
        'extra-never-print',
        '--range',
        'Sheet1!A1',
        '--json',
      ],
    ],
  ])('returns bounded JSON for %s', async (_name, argv) => {
    const result = await invoke(argv);
    expectSheetArgumentFailure(result);
    expect(JSON.stringify(result)).not.toContain('never-print');
  });

  it('preserves Sheet help without appending a failure envelope', async () => {
    const result = await invoke(['sheet', 'get', '--json', '--help']);
    expect(result.logs).toEqual([]);
    expect(result.stdout).toContain('Usage: docz sheet get');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBeUndefined();
  });

  it('preserves the standard version path', async () => {
    const result = await invoke(['--version']);
    expect(result.logs).toEqual([]);
    expect(result.stdout.trim()).toBe('test');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBeUndefined();
  });

  it('preserves human-readable errors outside Sheet JSON mode', async () => {
    const result = await invoke(['sheet', 'get', 'target', '--unknown']);
    expect(result.logs).toEqual([]);
    expect(result.stderr).toContain("error: unknown option '--unknown'");
    expect(result.exitCode).toBe(1);
  });
});
