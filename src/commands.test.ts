import { describe, expect, it } from 'vitest';
import { parseExpires } from './commands.js';

describe('parseExpires', () => {
  it('parses days', () => {
    const result = parseExpires('7d');
    const expected = Date.now() + 7 * 86400000;
    const diff = Math.abs(new Date(result).getTime() - expected);
    expect(diff).toBeLessThan(1000);
  });

  it('parses hours', () => {
    const result = parseExpires('24h');
    const expected = Date.now() + 24 * 3600000;
    const diff = Math.abs(new Date(result).getTime() - expected);
    expect(diff).toBeLessThan(1000);
  });

  it('throws on invalid format', () => {
    expect(() => parseExpires('abc')).toThrow('Invalid expires format');
    expect(() => parseExpires('7m')).toThrow('Invalid expires format');
  });
});
