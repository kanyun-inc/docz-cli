import type { SheetPreflightFailureResult } from './types.js';

const SHEET_VALUE_OPTIONS = new Set([
  '--range',
  '--values-json',
  '--request-id',
  '--timeout',
]);

export function isSheetJSONInvocation(argv: string[]): boolean {
  return (
    argv[0] === 'sheet' &&
    (argv[1] === 'get' || argv[1] === 'set') &&
    argv.includes('--json')
  );
}

/**
 * Commander treats a following option as the value of a required-value
 * option in some argv shapes (for example `--range --json`). Detect that
 * before parsing so Sheet JSON mode cannot silently fall back to human output.
 */
export function hasMissingSheetOptionValue(argv: string[]): boolean {
  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index];
    if (
      [...SHEET_VALUE_OPTIONS].some((option) =>
        argument.startsWith(`${option}=`)
      )
    ) {
      continue;
    }
    if (!SHEET_VALUE_OPTIONS.has(argument)) continue;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) return true;
    index += 1;
  }
  return false;
}

export function sheetArgumentFailure(): SheetPreflightFailureResult {
  return {
    outcome: 'FAILED',
    phase: 'validate',
    space_id: '',
    path: '',
    unit_id: null,
    identity_resolved: false,
    collaboration_status: 'NOT_STARTED',
    range: '',
    failure_code: 'sheet_arguments_invalid',
  };
}
