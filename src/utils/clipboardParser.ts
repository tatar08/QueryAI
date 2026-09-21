export type ClipboardFormat =
  | 'tsv'
  | 'csv'
  | 'json-array'
  | 'markdown-table'
  | 'unknown';

export type InferredSqlType =
  | 'INTEGER'
  | 'BIGINT'
  | 'REAL'
  | 'BOOLEAN'
  | 'DATE'
  | 'DATETIME'
  | 'TEXT'
  | 'JSON';

export interface InferredColumn {
  name: string;
  sqlType: InferredSqlType;
  nullable: boolean;
  sampleValues: string[];
  confidence: 'high' | 'low';
}

export interface ParsedClipboardData {
  format: ClipboardFormat;
  headers: string[];
  rows: string[][];
  inferredColumns: InferredColumn[];
  rowCount: number;
  hasHeaderRow: boolean;
  warnings: string[];
}

function detectFormat(text: string): ClipboardFormat {
  const trimmed = text.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try { JSON.parse(trimmed); return 'json-array'; } catch { /* not JSON */ }
  }
  const lines = trimmed.split('\n');
  if (
    lines.length >= 2 &&
    lines[0].includes('|') &&
    lines[1].match(/^\s*\|[\s\-:|]+\|\s*$/)
  ) {
    return 'markdown-table';
  }
  if (lines.some((l) => l.includes('\t'))) return 'tsv';
  if (lines.some((l) => l.includes(',') || l.includes(';'))) return 'csv';
  return 'unknown';
}

function parseTsv(text: string): string[][] {
  return text
    .trim()
    .split('\n')
    .map((line) => line.split('\t').map((c) => c.trim()));
}

function parseCsv(text: string): string[][] {
  const firstLine = text.split('\n')[0] ?? '';
  const separator =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0)
      ? ';'
      : ',';

  return text
    .trim()
    .split('\n')
    .map((line) => {
      const cells: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
          else inQuotes = !inQuotes;
        } else if (ch === separator && !inQuotes) {
          cells.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
      cells.push(current.trim());
      return cells;
    });
}

function parseJsonArray(text: string): { headers: string[]; rows: string[][] } | null {
  try {
    const parsed = JSON.parse(text.trim());
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    if (arr.length === 0 || typeof arr[0] !== 'object') return null;
    const headers = Object.keys(arr[0]);
    const rows = arr.map((obj: Record<string, unknown>) =>
      headers.map((h) => {
        const v = obj[h];
        if (v === null || v === undefined) return '';
        if (typeof v === 'object') return JSON.stringify(v);
        return String(v);
      })
    );
    return { headers, rows };
  } catch {
    return null;
  }
}

function parseMarkdown(text: string): string[][] {
  return text
    .trim()
    .split('\n')
    .filter((l) => l.trim().startsWith('|'))
    .filter((l) => !l.match(/^\s*\|[\s\-:|]+\|\s*$/))
    .map((l) =>
      l
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim())
    );
}

function sanitizeColumnName(name: string, index: number): string {
  const sanitized = name
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .toLowerCase();
  return sanitized || `col_${index + 1}`;
}

function deduplicateNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return count === 0 ? name : `${name}_${count}`;
  });
}

const INTEGER_RE = /^-?\d+$/;
const REAL_RE = /^-?\d*[.,]\d+$|^-?\d+[eE][+-]?\d+$/;
const BOOL_VALUES = new Set(['true', 'false', 'yes', 'no', '1', '0']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$|^\d{2}\/\d{2}\/\d{4}$|^\d{2}-\d{2}-\d{4}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

type RawType = InferredSqlType;

// Standard 32-bit signed range — a 12-13 digit barcode/reference number
// classifies as INTEGER by digit-only shape but would overflow a real
// Postgres/MySQL INTEGER column, so those values must infer as BIGINT.
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

function classifyValue(v: string): RawType {
  const lv = v.toLowerCase();
  if (DATETIME_RE.test(v)) return 'DATETIME';
  if (DATE_RE.test(v)) return 'DATE';
  if (INTEGER_RE.test(v)) {
    const n = Number(v);
    return n >= INT32_MIN && n <= INT32_MAX ? 'INTEGER' : 'BIGINT';
  }
  if (REAL_RE.test(v.replace(',', '.'))) return 'REAL';
  if (BOOL_VALUES.has(lv)) return 'BOOLEAN';
  if ((v.startsWith('{') || v.startsWith('[')) && (() => { try { JSON.parse(v); return true; } catch { return false; } })()) return 'JSON';
  return 'TEXT';
}

function inferType(values: string[]): { type: InferredSqlType; confidence: 'high' | 'low' } {
  const nonEmpty = values.filter((v) => v !== '');
  if (nonEmpty.length === 0) return { type: 'TEXT', confidence: 'low' };

  const types = nonEmpty.map(classifyValue);
  const unique = new Set(types);

  if (unique.size === 1) return { type: types[0], confidence: 'high' };
  if (unique.size === 2 && unique.has('INTEGER') && unique.has('REAL')) return { type: 'REAL', confidence: 'high' };
  if (unique.size === 2 && unique.has('INTEGER') && unique.has('BIGINT')) return { type: 'BIGINT', confidence: 'high' };

  return { type: 'TEXT', confidence: 'low' };
}

function isLikelyHeader(firstRow: string[], dataRows: string[][]): boolean {
  if (dataRows.length === 0) return true;
  // If all first-row values are non-numeric strings while data has numerics, likely header
  const sample = dataRows.slice(0, Math.min(5, dataRows.length));
  let headerMatchesDataType = 0;
  firstRow.forEach((h, i) => {
    const colValues = sample.map((r) => r[i] ?? '').filter(Boolean);
    if (colValues.length === 0) return;
    const { type: colType } = inferType(colValues);
    const { type: headerType } = inferType([h]);
    if (colType !== 'TEXT' && headerType === colType) headerMatchesDataType++;
  });
  return headerMatchesDataType < firstRow.length / 2;
}

function normalizeRows(rows: string[][]): string[][] {
  if (rows.length === 0) return rows;
  const maxCols = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => {
    const padded = [...r];
    while (padded.length < maxCols) padded.push('');
    return padded;
  });
}

// Evenly-spaced sample across the whole array, instead of a contiguous
// prefix. Merged multi-file datasets group all of one file-shape's rows
// together (e.g. every CN row before every ABB row), so a first-N-rows
// sample can be entirely one shape and badly misjudge a column's
// type/nullability for the other shape (only present later in the array).
function representativeSample<T>(rows: T[], sampleSize: number): T[] {
  if (rows.length <= sampleSize) return rows;
  const stride = rows.length / sampleSize;
  const sample: T[] = [];
  for (let i = 0; i < sampleSize; i++) {
    sample.push(rows[Math.floor(i * stride)]);
  }
  return sample;
}

const CURRENCY_CODES = new Set([
  'THB', 'USD', 'EUR', 'GBP', 'JPY', 'SGD', 'MYR', 'IDR', 'PHP', 'VND', 'CNY', 'KRW', 'AUD', 'HKD', 'TWD',
]);

// Best-effort suffix hinting at a headerless column's likely meaning, based on
// the shape of its sample values (date-like, currency code, barcode, amount,
// quantity, or a short repeated code). Never a guaranteed-correct name — it's
// a starting point the user renames in the schema editor afterward.
function guessColumnSuffix(values: string[]): string | null {
  const nonEmpty = values.filter((v) => v !== '');
  if (nonEmpty.length === 0) return null;
  const unique = [...new Set(nonEmpty)];
  const allMatch = (re: RegExp) => nonEmpty.every((v) => re.test(v));

  if (allMatch(/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/)) return 'date';
  if (allMatch(/^\d{8}$/)) return 'date';
  if (allMatch(/^\d{12,14}$/)) return 'barcode';
  if (allMatch(/^-?\d+\.\d{2}$/)) return 'amount';
  if (allMatch(/^[A-Z]{3}$/) && unique.every((v) => CURRENCY_CODES.has(v))) return 'currency';
  if (allMatch(/^-?\d+$/) && nonEmpty.every((v) => Math.abs(Number(v)) <= 999)) return 'qty';
  if (allMatch(/^[A-Z]{2,}\d{8,}$/)) return 'ref_no';
  if (allMatch(/^[A-Z0-9]{3,15}$/) && nonEmpty.every((v) => /[A-Z]/.test(v) && /\d/.test(v))) return 'code';
  return null;
}

// Names for a headerless data set: `col_N` plus a pattern-based hint suffix
// (e.g. `col_5_date`, `col_8_barcode`) so the schema editor starts from a more
// descriptive default than bare `col_N`, without pretending to know the real
// business meaning.
function guessHeaders(dataRows: string[][], colCount: number): string[] {
  const SAMPLE_SIZE = 50;
  const sample = dataRows.slice(0, SAMPLE_SIZE);
  return Array.from({ length: colCount }, (_, i) => {
    const values = sample.map((r) => r[i] ?? '');
    const suffix = guessColumnSuffix(values);
    return suffix ? `col_${i + 1}_${suffix}` : `col_${i + 1}`;
  });
}

export function parseClipboardText(text: string): ParsedClipboardData {
  const warnings: string[] = [];
  const format = detectFormat(text);

  let rawRows: string[][] = [];
  let hasHeaderRow = true;
  let presetHeaders: string[] | null = null;

  if (format === 'tsv') {
    rawRows = parseTsv(text);
  } else if (format === 'csv') {
    rawRows = parseCsv(text);
  } else if (format === 'json-array') {
    const result = parseJsonArray(text);
    if (result) {
      presetHeaders = result.headers;
      rawRows = result.rows;
      hasHeaderRow = false;
    }
  } else if (format === 'markdown-table') {
    rawRows = parseMarkdown(text);
  } else {
    rawRows = text.trim().split('\n').map((l) => [l.trim()]);
  }

  const before = rawRows.length;
  rawRows = rawRows.filter((r) => r.some((c) => c.trim() !== ''));
  const skipped = before - rawRows.length;
  if (skipped > 0) warnings.push(`${skipped} empty rows skipped`);

  if (rawRows.length === 0) {
    return { format, headers: [], rows: [], inferredColumns: [], rowCount: 0, hasHeaderRow: false, warnings };
  }

  rawRows = normalizeRows(rawRows);

  let headers: string[];
  let dataRows: string[][];

  if (presetHeaders) {
    headers = deduplicateNames(presetHeaders.map((h, i) => sanitizeColumnName(h, i)));
    dataRows = rawRows;
    hasHeaderRow = false;
  } else {
    const firstRow = rawRows[0];
    const rest = rawRows.slice(1);
    hasHeaderRow = isLikelyHeader(firstRow, rest);

    if (hasHeaderRow) {
      headers = deduplicateNames(firstRow.map((h, i) => sanitizeColumnName(h, i)));
      dataRows = rest;
    } else {
      headers = guessHeaders(rawRows, rawRows[0].length);
      dataRows = rawRows;
    }
  }

  const SAMPLE_SIZE = 50;
  const sample = dataRows.slice(0, SAMPLE_SIZE);

  const inferredColumns: InferredColumn[] = headers.map((name, i) => {
    const values = sample.map((r) => r[i] ?? '');
    const nonEmpty = values.filter((v) => v !== '');
    const nullable = values.length > 0 && nonEmpty.length < values.length * 0.8;
    const { type, confidence } = inferType(nonEmpty);
    if (confidence === 'low') {
      warnings.push(`Column "${name}" has mixed types, defaulted to TEXT`);
    }
    return { name, sqlType: type, nullable, sampleValues: nonEmpty.slice(0, 5), confidence };
  });

  return { format, headers, rows: dataRows, inferredColumns, rowCount: dataRows.length, hasHeaderRow, warnings };
}

export function reParseWithHeaderOption(
  text: string,
  hasHeaderRow: boolean,
  existingParsed: ParsedClipboardData,
): ParsedClipboardData {
  const format = existingParsed.format;
  let rawRows: string[][] = [];
  let presetHeaders: string[] | null = null;

  if (format === 'tsv') rawRows = parseTsv(text);
  else if (format === 'csv') rawRows = parseCsv(text);
  else if (format === 'json-array') {
    const result = parseJsonArray(text);
    if (result) { presetHeaders = result.headers; rawRows = result.rows; }
  } else if (format === 'markdown-table') rawRows = parseMarkdown(text);
  else rawRows = text.trim().split('\n').map((l) => [l.trim()]);

  rawRows = rawRows.filter((r) => r.some((c) => c.trim() !== ''));
  if (rawRows.length === 0) return { ...existingParsed, headers: [], rows: [], rowCount: 0 };

  rawRows = normalizeRows(rawRows);

  let headers: string[];
  let dataRows: string[][];

  if (presetHeaders) {
    headers = deduplicateNames(presetHeaders.map((h, i) => sanitizeColumnName(h, i)));
    dataRows = rawRows;
  } else if (hasHeaderRow) {
    headers = deduplicateNames(rawRows[0].map((h, i) => sanitizeColumnName(h, i)));
    dataRows = rawRows.slice(1);
  } else {
    headers = guessHeaders(rawRows, rawRows[0].length);
    dataRows = rawRows;
  }

  const SAMPLE_SIZE = 50;
  const sample = dataRows.slice(0, SAMPLE_SIZE);
  const inferredColumns: InferredColumn[] = headers.map((name, i) => {
    const values = sample.map((r) => r[i] ?? '');
    const nonEmpty = values.filter((v) => v !== '');
    const nullable = values.length > 0 && nonEmpty.length < values.length * 0.8;
    const { type, confidence } = inferType(nonEmpty);
    return { name, sqlType: type, nullable, sampleValues: nonEmpty.slice(0, 5), confidence };
  });

  return { ...existingParsed, headers, rows: dataRows, inferredColumns, rowCount: dataRows.length, hasHeaderRow, warnings: existingParsed.warnings };
}

export interface FileImportSource {
  /** File name (basename), used as-is as the value of the appended source column. */
  name: string;
  text: string;
}

/**
 * Merges several same-shaped files (e.g. daily CSV exports of the same report)
 * into one dataset, appending a trailing column recording which file each row
 * came from. Later files are conformed to the first file's column count
 * (padded/truncated) rather than rejected, with a warning when they differ.
 */
export function parseMultipleFiles(
  files: FileImportSource[],
  options?: { sourceColumnName?: string; hasHeaderRow?: boolean },
): ParsedClipboardData {
  if (files.length === 0) {
    return { format: 'unknown', headers: [], rows: [], inferredColumns: [], rowCount: 0, hasHeaderRow: false, warnings: [] };
  }

  const parseOne = (f: FileImportSource): ParsedClipboardData => {
    const initial = parseClipboardText(f.text);
    if (options?.hasHeaderRow === undefined || options.hasHeaderRow === initial.hasHeaderRow) {
      return initial;
    }
    return reParseWithHeaderOption(f.text, options.hasHeaderRow, initial);
  };

  const parsedFiles = files.map((file) => ({ file, parsed: parseOne(file) }));
  const base = parsedFiles[0].parsed;
  const baseColCount = base.headers.length;

  const warnings: string[] = [];
  const rows: string[][] = [];

  parsedFiles.forEach(({ file, parsed }, idx) => {
    if (idx > 0 && parsed.headers.length !== baseColCount) {
      warnings.push(
        `"${file.name}" has ${parsed.headers.length} column(s), expected ${baseColCount} (from "${files[0].name}") — rows padded/truncated to fit`,
      );
    }
    for (const row of parsed.rows) {
      const fixed = row.slice(0, baseColCount);
      while (fixed.length < baseColCount) fixed.push('');
      fixed.push(file.name);
      rows.push(fixed);
    }
    warnings.push(...parsed.warnings.map((w) => `${file.name}: ${w}`));
  });

  const sourceColumnName = sanitizeColumnName(options?.sourceColumnName ?? 'source_file', baseColCount);
  const headers = deduplicateNames([...base.headers, sourceColumnName]);

  const SAMPLE_SIZE = 500;
  const sample = representativeSample(rows, SAMPLE_SIZE);
  const inferredColumns: InferredColumn[] = headers.map((name, i) => {
    const values = sample.map((r) => r[i] ?? '');
    const nonEmpty = values.filter((v) => v !== '');
    const nullable = values.length > 0 && nonEmpty.length < values.length * 0.8;
    const { type, confidence } = inferType(nonEmpty);
    return { name, sqlType: type, nullable, sampleValues: nonEmpty.slice(0, 5), confidence };
  });

  return {
    format: base.format,
    headers,
    rows,
    inferredColumns,
    rowCount: rows.length,
    hasHeaderRow: base.hasHeaderRow,
    warnings,
  };
}

// Groups files by their headerless column count, so a caller can tell (before
// deciding on names) that a batch actually contains several distinct report
// layouts — e.g. one export with an extra trailing column — rather than a
// single shape with a few malformed files.
export function detectFileColumnCounts(files: FileImportSource[]): Map<number, string[]> {
  const byCount = new Map<number, string[]>();
  for (const file of files) {
    const parsed = reParseWithHeaderOption(file.text, false, parseClipboardText(file.text));
    const count = parsed.headers.length;
    const names = byCount.get(count) ?? [];
    names.push(file.name);
    byCount.set(count, names);
  }
  return byCount;
}

/**
 * Merges files that use *different* column layouts (identified by their
 * column count, e.g. a 15-column export vs. a 14-column one) using an
 * explicit, user-supplied header list per layout — rather than assuming every
 * file shares one shape and padding/truncating by position. That assumption
 * breaks when the same-numbered column means different things across
 * layouts (e.g. column 4 is `invoice_id` in one export and `delivery_order_id`
 * in another): merging by position would silently mix the two. Rows are
 * instead aligned by column *name* into the union of all supplied headers,
 * leaving a cell blank wherever a file's layout doesn't have that column.
 */
export function parseMultipleFilesWithSchemas(
  files: FileImportSource[],
  columnNamesByCount: Record<number, string[]>,
  options?: { sourceColumnName?: string },
): ParsedClipboardData {
  if (files.length === 0) {
    return { format: 'unknown', headers: [], rows: [], inferredColumns: [], rowCount: 0, hasHeaderRow: false, warnings: [] };
  }

  const warnings: string[] = [];

  const parsedFiles = files.map((file) => {
    const raw = reParseWithHeaderOption(file.text, false, parseClipboardText(file.text));
    const colCount = raw.headers.length;
    let names = columnNamesByCount[colCount];
    if (!names) {
      names = raw.headers; // no schema supplied for this shape — fall back to guessed names
    } else if (names.length !== colCount) {
      warnings.push(
        `"${file.name}" has ${colCount} column(s) but the supplied schema for that shape has ${names.length} name(s) — extra columns are dropped/left blank`,
      );
    }
    const headers = deduplicateNames(names.map((n, i) => sanitizeColumnName(n, i)));
    return { file, headers, rows: raw.rows, warnings: raw.warnings };
  });

  const unionHeaders: string[] = [];
  const seen = new Set<string>();
  for (const { headers } of parsedFiles) {
    for (const h of headers) {
      if (!seen.has(h)) {
        seen.add(h);
        unionHeaders.push(h);
      }
    }
  }

  const rows: string[][] = [];
  for (const { file, headers, rows: fileRows, warnings: fileWarnings } of parsedFiles) {
    const localIndexByHeader = new Map(headers.map((h, i) => [h, i]));
    for (const row of fileRows) {
      const aligned = unionHeaders.map((h) => {
        const localIdx = localIndexByHeader.get(h);
        return localIdx === undefined ? '' : (row[localIdx] ?? '');
      });
      aligned.push(file.name);
      rows.push(aligned);
    }
    warnings.push(...fileWarnings.map((w) => `${file.name}: ${w}`));
  }

  const sourceColumnName = sanitizeColumnName(options?.sourceColumnName ?? 'source_file', unionHeaders.length);
  const headers = deduplicateNames([...unionHeaders, sourceColumnName]);

  const SAMPLE_SIZE = 500;
  const sample = representativeSample(rows, SAMPLE_SIZE);
  const inferredColumns: InferredColumn[] = headers.map((name, i) => {
    const values = sample.map((r) => r[i] ?? '');
    const nonEmpty = values.filter((v) => v !== '');
    const nullable = values.length > 0 && nonEmpty.length < values.length * 0.8;
    const { type, confidence } = inferType(nonEmpty);
    return { name, sqlType: type, nullable, sampleValues: nonEmpty.slice(0, 5), confidence };
  });

  return {
    format: 'csv',
    headers,
    rows,
    inferredColumns,
    rowCount: rows.length,
    hasHeaderRow: false,
    warnings,
  };
}
