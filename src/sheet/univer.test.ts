import { LogLevel } from '@univerjs/core';
import { CollaborationStatus } from '@univerjs-pro/collaboration-client';
import { describe, expect, it, vi } from 'vitest';
import {
  closePendingCollaborationSocket,
  runDeferredCleanup,
  SHEET_UNIVER_LOG_LEVEL,
  validateUniverEndpoint,
  waitUntil,
  withUniverTimeout,
} from './univer.js';

describe('Univer logging', () => {
  it('keeps vendor transport logs disabled to protect credentials', () => {
    expect(SHEET_UNIVER_LOG_LEVEL).toBe(LogLevel.SILENT);
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
