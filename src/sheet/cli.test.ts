import { describe, expect, it } from 'vitest';
import {
  hasMissingSheetOptionValue,
  isSheetJSONInvocation,
  sheetArgumentFailure,
} from './cli.js';

describe('Sheet CLI argv guard', () => {
  it('recognizes only Sheet get/set JSON invocations', () => {
    expect(isSheetJSONInvocation(['sheet', 'get', 'target', '--json'])).toBe(
      true
    );
    expect(isSheetJSONInvocation(['sheet', 'set', 'target', '--json'])).toBe(
      true
    );
    expect(isSheetJSONInvocation(['sheet', 'get', 'target'])).toBe(false);
    expect(isSheetJSONInvocation(['cat', 'target', '--json'])).toBe(false);
  });

  it('detects options whose value is missing or replaced by --json', () => {
    expect(
      hasMissingSheetOptionValue([
        'sheet',
        'get',
        'target',
        '--json',
        '--range',
      ])
    ).toBe(true);
    expect(
      hasMissingSheetOptionValue([
        'sheet',
        'get',
        'target',
        '--range',
        '--json',
      ])
    ).toBe(true);
    expect(
      hasMissingSheetOptionValue([
        'sheet',
        'set',
        'target',
        '--range=Sheet1!A1',
        '--values-json',
        '[[1]]',
        '--json',
      ])
    ).toBe(false);
  });

  it('produces a bounded failure without echoing argv', () => {
    const result = sheetArgumentFailure();
    expect(result).toMatchObject({
      outcome: 'FAILED',
      phase: 'validate',
      unit_id: null,
      identity_resolved: false,
      failure_code: 'sheet_arguments_invalid',
    });
    expect(JSON.stringify(result)).not.toContain('token');
  });
});
