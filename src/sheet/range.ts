export interface ParsedSheetRange {
  sheetName: string;
  a1: string;
  rows: number;
  columns: number;
}

const RANGE_RE =
  /^(.+)!\$?([A-Za-z]+)\$?([1-9]\d*)(?::\$?([A-Za-z]+)\$?([1-9]\d*))?$/;

function columnNumber(value: string): number {
  let result = 0;
  for (const char of value.toUpperCase()) {
    result = result * 26 + char.charCodeAt(0) - 64;
  }
  return result;
}

export function parseSheetRange(input: string): ParsedSheetRange {
  const match = input.match(RANGE_RE);
  if (!match) {
    throw new Error(
      `Invalid Sheet range "${input}". Expected Sheet1!A1 or Sheet1!A1:B2.`
    );
  }
  const [, rawSheet, startColumn, startRow, rawEndColumn, rawEndRow] = match;
  const sheetName = rawSheet.replace(/^'(.*)'$/, '$1').replace(/''/g, "'");
  const endColumn = rawEndColumn ?? startColumn;
  const endRow = rawEndRow ?? startRow;
  const rows = Number(endRow) - Number(startRow) + 1;
  const columns = columnNumber(endColumn) - columnNumber(startColumn) + 1;
  if (!sheetName || rows <= 0 || columns <= 0) {
    throw new Error(`Invalid descending or empty Sheet range "${input}".`);
  }
  const a1 = `${startColumn.toUpperCase()}${startRow}${rawEndColumn ? `:${endColumn.toUpperCase()}${endRow}` : ''}`;
  return { sheetName, a1, rows, columns };
}

/** Stable audit identity for logically equivalent A1 range spellings. */
export function normalizeSheetRange(range: ParsedSheetRange): string {
  // Quote names containing separators or quotes so the canonical identity can
  // be parsed again without changing the worksheet name.
  const sheetName = /[!']/.test(range.sheetName)
    ? `'${range.sheetName.replace(/'/g, "''")}'`
    : range.sheetName;
  return `${sheetName}!${range.a1}`;
}

export function parseValuesMatrix(
  json: string,
  range: ParsedSheetRange
): unknown[][] {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('--values-json must be valid JSON.');
  }
  if (!Array.isArray(value) || !value.every(Array.isArray)) {
    throw new Error('--values-json must be a two-dimensional JSON array.');
  }
  const matrix = value as unknown[][];
  if (
    matrix.length !== range.rows ||
    matrix.some((row) => row.length !== range.columns)
  ) {
    throw new Error(
      `Value shape ${matrix.length}x${matrix[0]?.length ?? 0} does not match range ${range.rows}x${range.columns}.`
    );
  }
  return matrix;
}
