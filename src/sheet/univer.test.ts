import { LogLevel } from '@univerjs/core';
import { CollaborationStatus } from '@univerjs-pro/collaboration-client';
import { describe, expect, it, vi } from 'vitest';
import {
  closePendingCollaborationSocket,
  runDeferredCleanup,
  SHEET_UNIVER_LOG_LEVEL,
  sheetSocketEventForVendor,
  validateUniverEndpoint,
  waitUntil,
  withUniverTimeout,
} from './univer.js';

describe('Univer logging', () => {
  it('keeps vendor transport logs disabled to protect credentials', () => {
    expect(SHEET_UNIVER_LOG_LEVEL).toBe(LogLevel.SILENT);
  });

  it('removes request headers from WebSocket errors before vendor logging', () => {
    const secret = 'unique-sheet-token-must-not-leak';
    const rawEvent = {
      type: 'error',
      target: {
        _req: {
          _header: `Authorization: Bearer ${secret}`,
        },
      },
    };
    const safeEvent = sheetSocketEventForVendor('error', rawEvent);
    expect(safeEvent).not.toBe(rawEvent);
    expect(JSON.stringify(safeEvent)).not.toContain(secret);
    expect(safeEvent).toEqual({
      type: 'error',
      message: 'Docz Sheet WebSocket transport error.',
    });
  });

  it('keeps non-error socket events unchanged', () => {
    const message = { data: 'safe-payload' };
    expect(sheetSocketEventForVendor('message', message)).toBe(message);
  });
});

describe('Univer endpoint validation', () => {
  it('accepts only the same Docz origin', () => {
    expect(
      validateUniverEndpoint(
        'https://docz.example.com/api/univer',
        'https://docz.example.com/'
      ).pathname
    ).toBe('/api/univer');
    expect(() =>
      validateUniverEndpoint(
        'https://evil.example.com/api/univer',
        'https://docz.example.com'
      )
    ).toThrow('cross-origin');
  });

  it('rejects URL credentials and unsupported schemes', () => {
    expect(() =>
      validateUniverEndpoint(
        'https://user:secret@docz.example.com/api/univer',
        'https://docz.example.com'
      )
    ).toThrow('unsafe');
    expect(() =>
      validateUniverEndpoint('file:///tmp/univer', 'https://docz.example.com')
    ).toThrow('unsafe');
  });
});

describe('Univer load timeout', () => {
  it('clears the timeout when loading succeeds early', async () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    await expect(
      withUniverTimeout(Promise.resolve('ready'), 20_000)
    ).resolves.toBe('ready');
    expect(clear).toHaveBeenCalledOnce();
    clear.mockRestore();
  });

  it('rejects an in-flight load when the command is interrupted', async () => {
    const controller = new AbortController();
    const waiting = withUniverTimeout(
      new Promise<never>(() => undefined),
      20_000,
      controller.signal
    );
    controller.abort();
    await expect(waiting).rejects.toThrow('interrupted');
  });
});

describe('Univer collaboration status wait', () => {
  it('allows the initial OFFLINE state to progress through a bounded probe', async () => {
    vi.useFakeTimers();
    let current = CollaborationStatus.OFFLINE;
    const dispose = vi.fn();
    const status = vi.fn(() => current);
    const waiting = waitUntil(
      status,
      (value) => value === CollaborationStatus.SYNCED,
      1_000,
      () => ({ dispose })
    );

    current = CollaborationStatus.SYNCED;
    await vi.advanceTimersByTimeAsync(25);
    await expect(waiting).resolves.toBe('SYNCED');
    expect(dispose).toHaveBeenCalledOnce();
    expect(status.mock.calls.length).toBeLessThanOrEqual(3);
    vi.useRealTimers();
  });

  it('fails when an established session transitions back to OFFLINE', async () => {
    let listener: ((status: CollaborationStatus) => void) | undefined;
    const waiting = waitUntil(
      () => CollaborationStatus.PENDING,
      (value) => value === CollaborationStatus.SYNCED,
      1_000,
      (next) => {
        listener = next;
        return { dispose: vi.fn() };
      }
    );

    listener?.(CollaborationStatus.PENDING);
    listener?.(CollaborationStatus.OFFLINE);
    await expect(waiting).rejects.toThrow('offline');
  });

  it('aborts immediately and disposes status observers and timers', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const dispose = vi.fn();
    const status = vi.fn(() => CollaborationStatus.PENDING);
    const waiting = waitUntil(
      status,
      () => false,
      30_000,
      () => ({ dispose }),
      controller.signal
    );

    controller.abort();
    await expect(waiting).rejects.toThrow('interrupted');
    expect(dispose).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    const callsAfterAbort = status.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(status).toHaveBeenCalledTimes(callsAfterAbort);
    vi.useRealTimers();
  });

  it('does not accept SYNCED until state cycles and revision advances', async () => {
    vi.useFakeTimers();
    let revision = 7;
    let sawUnsynchronizedState = false;
    const waiting = waitUntil(
      () => CollaborationStatus.SYNCED,
      (value) => {
        if (value !== CollaborationStatus.SYNCED) sawUnsynchronizedState = true;
        return (
          sawUnsynchronizedState &&
          value === CollaborationStatus.SYNCED &&
          revision > 7
        );
      },
      1_000,
      (listener) => {
        listener(CollaborationStatus.PENDING);
        return { dispose: vi.fn() };
      }
    );
    let settled = false;
    void waiting.finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false);
    revision = 8;
    await vi.advanceTimersByTimeAsync(100);
    await expect(waiting).resolves.toBe('SYNCED');
    vi.useRealTimers();
  });
});

describe('Univer Node cleanup', () => {
  it('closes an in-flight 0.21.1 candidate socket', () => {
    const close = vi.fn();
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => ({ unsubscribe }));
    closePendingCollaborationSocket({
      _candidateSocket: { close, error$: { subscribe } },
    });
    expect(subscribe).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('is safe when no candidate socket exists', () => {
    expect(() => closePendingCollaborationSocket({})).not.toThrow();
  });

  it('awaits best-effort cleanup and absorbs cleanup errors', async () => {
    const order: string[] = [];
    await expect(
      runDeferredCleanup([
        () => order.push('first'),
        () => {
          throw new Error('cleanup failed');
        },
        () => order.push('last'),
      ])
    ).resolves.toBeUndefined();
    expect(order).toEqual(['first', 'last']);
  });
});
