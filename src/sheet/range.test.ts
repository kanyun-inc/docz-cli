import { describe, expect, it } from 'vitest';
import { parseSheetRange, parseValuesMatrix } from './range.js';

describe('Sheet range parsing', () => {
  it('parses a rectangular A1 range', () => {
    expect(parseSheetRange("'Budget 2026'!$A$1:C2")).toEqual({
      sheetName: 'Budget 2026',
      a1: 'A1:C2',
      rows: 2,
      columns: 3,
    });
  });

  it('rejects descending and unqualified ranges', () => {
    expect(() => parseSheetRange('A1:B2')).toThrow('Expected');
    expect(() => parseSheetRange('Sheet1!B2:A1')).toThrow('descending');
  });

  it('requires values to match the target shape', () => {
    const range = parseSheetRange('Sheet1!A1:B2');
    expect(parseValuesMatrix('[[1,2],[3,4]]', range)).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(() => parseValuesMatrix('[[1,2]]', range)).toThrow('does not match');
  });
});
