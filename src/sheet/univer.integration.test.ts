import { expect, it } from 'vitest';
import { DocSyncClient } from '../client.js';
import { openUniverSheet } from './univer.js';

const baseUrl = process.env.DOCZ_SHEET_E2E_BASE_URL;
const token = process.env.DOCZ_SHEET_E2E_TOKEN;
const spaceId = process.env.DOCZ_SHEET_E2E_SPACE_ID;
const path = process.env.DOCZ_SHEET_E2E_PATH;
const enabled = Boolean(baseUrl && token && spaceId && path);

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required for Sheet E2E`);
  return value;
}

(enabled ? it : it.skip)(
  'opens the real Univer 0.21.1 Node stack, writes, synchronizes, reads, and disposes',
  async () => {
    const resolvedBaseUrl = required(baseUrl, 'DOCZ_SHEET_E2E_BASE_URL');
    const resolvedToken = required(token, 'DOCZ_SHEET_E2E_TOKEN');
    const resolvedSpaceId = required(spaceId, 'DOCZ_SHEET_E2E_SPACE_ID');
    const resolvedPath = required(path, 'DOCZ_SHEET_E2E_PATH');
    const client = new DocSyncClient(resolvedBaseUrl, resolvedToken);
    const writerSession = await client.getSheetSession(
      resolvedSpaceId,
      resolvedPath
    );
    const writer = await openUniverSheet({
      session: writerSession,
      doczBaseUrl: resolvedBaseUrl,
      token: resolvedToken,
      clientVersion: 'integration-test',
      timeoutMs: 30_000,
    });
    const marker = `node-e2e-${Date.now()}`;
    try {
      await writer.waitForInitialSync(30_000);
      const startRevision = writer.revision();
      let mutationStarted = false;
      let mutationApplied = false;
      const synchronized = writer.waitForWriteSync(
        30_000,
        () => mutationStarted,
        () => mutationApplied
      );
      void synchronized.catch(() => undefined);
      await writer.write(
        'Sheet1',
        'J1:K2',
        [
          [marker, 3014],
          ['integration', 1],
        ],
        () => {
          mutationStarted = true;
        }
      );
      mutationApplied = true;
      await expect(synchronized).resolves.toBe('SYNCED');
      expect(writer.revision()).toBeGreaterThan(startRevision);
    } finally {
      await writer.dispose();
    }

    const readerSession = await client.getSheetSession(
      resolvedSpaceId,
      resolvedPath
    );
    const reader = await openUniverSheet({
      session: readerSession,
      doczBaseUrl: resolvedBaseUrl,
      token: resolvedToken,
      clientVersion: 'integration-test',
      timeoutMs: 30_000,
    });
    try {
      await reader.waitForInitialSync(30_000);
      expect(reader.read('Sheet1', 'J1:K2')).toEqual([
        [marker, 3014],
        ['integration', 1],
      ]);
    } finally {
      await reader.dispose();
    }
  },
  60_000
);
