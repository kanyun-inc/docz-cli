import { describe, expect, it, vi } from 'vitest';
import { validateUniverEndpoint, withUniverTimeout } from './univer.js';

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
