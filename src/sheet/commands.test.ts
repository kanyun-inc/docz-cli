import { describe, expect, it, vi } from 'vitest';
import type { DocSyncClient } from '../client.js';
import { executeSheetGet, executeSheetSet } from '../commands.js';
import type {
  OpenSheetOptions,
  OpenUniverSheet,
  SheetOperation,
  SheetSession,
} from './types.js';

const session: SheetSession = {
  space_id: 'space-1',
  path: 'Budget.sheet.json',
  file_ref_id: 'ref-1',
  unit_id: 'unit-1',
  role: 'editor',
  can_read: true,
  can_write: true,
  univer_endpoint: 'https://docz.example.com/api/univer',
  descriptor_version: 0,
};

function operation(outcome: SheetOperation['outcome']): SheetOperation {
  return {
    id: 'op-1',
    request_id: 'request-1',
    user_id: 'user-1',
    space_id: 'space-1',
    file_ref_id: 'ref-1',
    file_path: 'Budget.sheet.json',
    unit_id: 'unit-1',
    client_type: 'docz-cli',
    client_version: 'test',
    operation: 'set',
    outcome,
    deadline_at: new Date(Date.now() + 120_000).toISOString(),
  };
}

function fakeSheet(overrides: Partial<OpenUniverSheet> = {}): OpenUniverSheet {
  return {
    read: vi.fn(() => [[42]]),
    write: vi.fn(),
    status: vi.fn(() => 'SYNCED'),
    waitForInitialSync: vi.fn(async () => 'SYNCED'),
    waitForWriteSync: vi.fn(async () => 'SYNCED'),
    dispose: vi.fn(),
    ...overrides,
  };
}

function fakeClient(overrides: Record<string, unknown> = {}): DocSyncClient {
  return {
    getSheetSession: vi.fn(async () => session),
    beginSheetOperation: vi.fn(async () => operation('PENDING')),
    finalizeSheetOperation: vi.fn(async () => operation('SYNCED')),
    getSheetOperation: vi.fn(async () => operation('SYNCED')),
    ...overrides,
  } as unknown as DocSyncClient;
}

describe('Sheet commands', () => {
  it('reads current values for a viewer and disposes the SDK', async () => {
    const sheet = fakeSheet();
    const result = await executeSheetGet({
      client: fakeClient({
        getSheetSession: vi.fn(async () => ({
          ...session,
          role: 'reader',
          can_write: false,
        })),
      }),
      baseUrl: 'https://docz.example.com',
      token: 'fake-token',
      spaceId: 'space-1',
      path: session.path,
      range: 'Sheet1!A1',
      clientVersion: 'test',
      opener: vi.fn(async () => sheet),
    });
    expect(result.outcome).toBe('SYNCED');
    expect(result.values).toEqual([[42]]);
    expect(sheet.dispose).toHaveBeenCalledOnce();
  });

  it('rejects viewer writes before audit or mutation', async () => {
    const begin = vi.fn();
    const opener = vi.fn();
    const result = await executeSheetSet({
      client: fakeClient({
        getSheetSession: vi.fn(async () => ({
          ...session,
          role: 'reader',
          can_write: false,
        })),
        beginSheetOperation: begin,
      }),
      baseUrl: 'https://docz.example.com',
      token: 'fake-token',
      spaceId: 'space-1',
      path: session.path,
      range: 'Sheet1!A1',
      valuesJson: '[[1]]',
      clientVersion: 'test',
      opener,
    });
    expect(result.outcome).toBe('FAILED');
    expect(begin).not.toHaveBeenCalled();
    expect(opener).not.toHaveBeenCalled();
  });

  it('reports SYNCED only after SDK synchronization and audit confirmation', async () => {
    const sheet = fakeSheet();
    const client = fakeClient();
    const result = await executeSheetSet({
      client,
      baseUrl: 'https://docz.example.com',
      token: 'fake-token',
      spaceId: 'space-1',
      path: session.path,
      range: 'Sheet1!A1',
      valuesJson: '[[1]]',
      clientVersion: 'test',
      requestId: 'request-1',
      opener: vi.fn(async () => sheet),
    });
    expect(result.outcome).toBe('SYNCED');
    expect(sheet.write).toHaveBeenCalledWith('Sheet1', 'A1', [[1]]);
    expect(client.finalizeSheetOperation).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'SYNCED', operationId: 'op-1' })
    );
    expect(sheet.dispose).toHaveBeenCalledOnce();
  });

  it('reports UNKNOWN when confirmation is lost after mutation', async () => {
    const sheet = fakeSheet({
      waitForWriteSync: vi.fn(async () => {
        throw new Error('socket closed with a sensitive URL');
      }),
      status: vi.fn(() => 'AWAITING'),
    });
    const result = await executeSheetSet({
      client: fakeClient({
        finalizeSheetOperation: vi.fn(async () => {
          throw new Error('response lost');
        }),
        getSheetOperation: vi.fn(async () => {
          throw new Error('network unavailable');
        }),
      }),
      baseUrl: 'https://docz.example.com',
      token: 'fake-token',
      spaceId: 'space-1',
      path: session.path,
      range: 'Sheet1!A1',
      valuesJson: '[[1]]',
      clientVersion: 'test',
      requestId: 'request-1',
      opener: vi.fn(async () => sheet),
    });
    expect(result.outcome).toBe('UNKNOWN');
    expect(result.warning).toContain('reread');
    expect(JSON.stringify(result)).not.toContain('sensitive URL');
  });

  it('does not repeat a mutation when request id already has a terminal outcome', async () => {
    const opener = vi.fn();
    const result = await executeSheetSet({
      client: fakeClient({
        beginSheetOperation: vi.fn(async () => operation('SYNCED')),
      }),
      baseUrl: 'https://docz.example.com',
      token: 'fake-token',
      spaceId: 'space-1',
      path: session.path,
      range: 'Sheet1!A1',
      valuesJson: '[[1]]',
      clientVersion: 'test',
      requestId: 'request-1',
      opener,
    });
    expect(result.outcome).toBe('SYNCED');
    expect(opener).not.toHaveBeenCalled();
  });

  it('recovers a lost begin response by querying the same request id', async () => {
    const begin = vi.fn(async () => {
      throw new Error('response lost');
    });
    const query = vi.fn(async () => operation('PENDING'));
    const sheet = fakeSheet();
    const result = await executeSheetSet({
      client: fakeClient({
        beginSheetOperation: begin,
        getSheetOperation: query,
      }),
      baseUrl: 'https://docz.example.com',
      token: 'fake-token',
      spaceId: 'space-1',
      path: session.path,
      range: 'Sheet1!A1',
      valuesJson: '[[1]]',
      clientVersion: 'test',
      requestId: 'request-1',
      opener: vi.fn(async () => sheet),
    });
    expect(result.outcome).toBe('SYNCED');
    expect(query).toHaveBeenCalledWith(
      'space-1',
      'request-1',
      expect.any(AbortSignal)
    );
    expect(sheet.write).toHaveBeenCalledOnce();
  });

  it('reports a request id and does not mutate when begin cannot be confirmed', async () => {
    const opener = vi.fn();
    const result = await executeSheetSet({
      client: fakeClient({
        beginSheetOperation: vi.fn(async () => {
          throw new Error('network unavailable');
        }),
        getSheetOperation: vi.fn(async () => {
          throw new Error('network unavailable');
        }),
      }),
      baseUrl: 'https://docz.example.com',
      token: 'fake-token',
      spaceId: 'space-1',
      path: session.path,
      range: 'Sheet1!A1',
      valuesJson: '[[1]]',
      clientVersion: 'test',
      requestId: 'request-unconfirmed',
      opener,
    });
    expect(result).toMatchObject({
      outcome: 'FAILED',
      request_id: 'request-unconfirmed',
      failure_code: 'operation_begin_unconfirmed',
    });
    expect(opener).not.toHaveBeenCalled();
  });

  it('fails before mutation when the session identity changes before begin', async () => {
    const opener = vi.fn();
    const client = fakeClient({
      beginSheetOperation: vi.fn(async () => ({
        ...operation('PENDING'),
        unit_id: 'unit-after-replace',
      })),
      finalizeSheetOperation: vi.fn(async () => operation('FAILED')),
    });
    const result = await executeSheetSet({
      client,
      baseUrl: 'https://docz.example.com',
      token: 'fake-token',
      spaceId: 'space-1',
      path: session.path,
      range: 'Sheet1!A1',
      valuesJson: '[[1]]',
      clientVersion: 'test',
      opener,
    });
    expect(result.outcome).toBe('FAILED');
    expect(result.failure_code).toBe('sheet_identity_changed');
    expect(opener).not.toHaveBeenCalled();
    expect(client.finalizeSheetOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'FAILED',
        failureCode: 'sheet_identity_changed',
      })
    );
  });

  it('rejects a phase timeout above the operation safety cap', async () => {
    await expect(
      executeSheetSet({
        client: fakeClient(),
        baseUrl: 'https://docz.example.com',
        token: 'fake-token',
        spaceId: 'space-1',
        path: session.path,
        range: 'Sheet1!A1',
        valuesJson: '[[1]]',
        clientVersion: 'test',
        timeoutMs: 30_001,
        opener: vi.fn(),
      })
    ).rejects.toThrow('must not exceed 30000ms');
  });

  it('caps every write phase to the remaining server deadline', async () => {
    const shortDeadline = {
      ...operation('PENDING'),
      deadline_at: new Date(Date.now() + 8_000).toISOString(),
    };
    const sheet = fakeSheet();
    let openedTimeout: number | undefined;
    const opener = vi.fn(async (options: OpenSheetOptions) => {
      openedTimeout = options.timeoutMs;
      return sheet;
    });
    await executeSheetSet({
      client: fakeClient({
        beginSheetOperation: vi.fn(async () => shortDeadline),
      }),
      baseUrl: 'https://docz.example.com',
      token: 'fake-token',
      spaceId: 'space-1',
      path: session.path,
      range: 'Sheet1!A1',
      valuesJson: '[[1]]',
      clientVersion: 'test',
      timeoutMs: 30_000,
      opener,
    });
    expect(openedTimeout).toBeLessThanOrEqual(3_000);
    expect(sheet.waitForInitialSync).toHaveBeenCalledWith(expect.any(Number));
    expect(sheet.waitForWriteSync).toHaveBeenCalledWith(expect.any(Number));
  });
});
