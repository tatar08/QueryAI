import { describe, it, expect } from 'vitest';
import {
  parseClipboardText,
  reParseWithHeaderOption,
  parseMultipleFiles,
  parseMultipleFilesWithSchemas,
  detectFileColumnCounts,
} from '../../src/utils/clipboardParser';

describe('detectFormat', () => {
  it('detects TSV from tab-separated content', () => {
    const result = parseClipboardText('name\tage\tCity\nAlice\t30\tRome\nBob\t25\tMilan');
    expect(result.format).toBe('tsv');
  });

  it('detects JSON array', () => {
    const result = parseClipboardText('[{"name":"Alice","age":30},{"name":"Bob","age":25}]');
    expect(result.format).toBe('json-array');
  });

  it('detects CSV', () => {
    const result = parseClipboardText('name,age,city\nAlice,30,Rome\nBob,25,Milan');
    expect(result.format).toBe('csv');
  });

  it('detects Markdown table', () => {
    const md = '| name | age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |';
    const result = parseClipboardText(md);
    expect(result.format).toBe('markdown-table');
  });
});

describe('TSV parsing', () => {
  it('extracts headers and rows correctly', () => {
    const result = parseClipboardText('name\tage\nAlice\t30\nBob\t25');
    expect(result.headers).toEqual(['name', 'age']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual(['Alice', '30']);
    expect(result.rowCount).toBe(2);
    expect(result.hasHeaderRow).toBe(true);
  });

  it('sanitizes column names with special chars', () => {
    const result = parseClipboardText('First Name\tDate of Birth\nAlice\t1990-01-01');
    expect(result.headers[0]).toBe('first_name');
    expect(result.headers[1]).toBe('date_of_birth');
  });

  it('deduplicates column names', () => {
    const result = parseClipboardText('id\tid\tid\n1\t2\t3');
    expect(result.headers).toEqual(['id', 'id_1', 'id_2']);
  });
});

describe('JSON parsing', () => {
  it('extracts keys as headers', () => {
    const json = '[{"id":1,"email":"a@b.com"},{"id":2,"email":"c@d.com"}]';
    const result = parseClipboardText(json);
    expect(result.headers).toEqual(['id', 'email']);
    expect(result.rows).toHaveLength(2);
    expect(result.hasHeaderRow).toBe(false);
  });

  it('handles single JSON object', () => {
    const result = parseClipboardText('{"name":"Alice","age":30}');
    expect(result.headers).toEqual(['name', 'age']);
    expect(result.rows).toHaveLength(1);
  });

  it('serializes nested objects to JSON string', () => {
    const result = parseClipboardText('[{"id":1,"meta":{"key":"val"}}]');
    expect(result.rows[0][1]).toBe('{"key":"val"}');
  });
});

describe('CSV parsing', () => {
  it('parses comma-separated values', () => {
    const result = parseClipboardText('name,age\nAlice,30\nBob,25');
    expect(result.headers).toEqual(['name', 'age']);
    expect(result.rows).toHaveLength(2);
  });

  it('handles quoted fields with commas', () => {
    const result = parseClipboardText('name,address\nAlice,"Rome, Italy"\nBob,"Milan, Italy"');
    expect(result.rows[0][1]).toBe('Rome, Italy');
  });

  it('handles semicolon separator', () => {
    const result = parseClipboardText('name;age\nAlice;30\nBob;25');
    expect(result.headers).toEqual(['name', 'age']);
    expect(result.rows[0]).toEqual(['Alice', '30']);
  });
});

describe('Markdown table parsing', () => {
  it('parses header and data rows, skipping separator', () => {
    const md = '| id | name | city |\n|---|---|---|\n| 1 | Alice | Rome |\n| 2 | Bob | Milan |';
    const result = parseClipboardText(md);
    expect(result.headers).toEqual(['id', 'name', 'city']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual(['1', 'Alice', 'Rome']);
  });
});

describe('Type inference', () => {
  it('infers INTEGER for integer columns', () => {
    const result = parseClipboardText('id\tcount\n1\t100\n2\t200');
    const idCol = result.inferredColumns.find((c) => c.name === 'id');
    expect(idCol?.sqlType).toBe('INTEGER');
    expect(idCol?.confidence).toBe('high');
  });

  it('infers BIGINT for all-digit values that overflow a 32-bit INTEGER', () => {
    // Barcode-like values (e.g. EAN-13) commonly exceed Postgres/MySQL's
    // 32-bit INTEGER range (max 2147483647) but still parse as all-digit.
    const result = parseClipboardText('barcode\n641628406784\n9788836036493');
    expect(result.inferredColumns[0].sqlType).toBe('BIGINT');
    expect(result.inferredColumns[0].confidence).toBe('high');
  });

  it('promotes a mixed INTEGER/BIGINT column to BIGINT', () => {
    const result = parseClipboardText('value\n1\n641628406784');
    expect(result.inferredColumns[0].sqlType).toBe('BIGINT');
    expect(result.inferredColumns[0].confidence).toBe('high');
  });

  it('infers REAL for decimal columns', () => {
    const result = parseClipboardText('price\n1.99\n29.99\n0.50');
    expect(result.inferredColumns[0].sqlType).toBe('REAL');
  });

  it('infers BOOLEAN for boolean columns', () => {
    const result = parseClipboardText('active\ntrue\nfalse\ntrue');
    expect(result.inferredColumns[0].sqlType).toBe('BOOLEAN');
  });

  it('infers DATE for date columns', () => {
    const result = parseClipboardText('created_at\n2024-01-01\n2024-06-15\n2024-12-31');
    expect(result.inferredColumns[0].sqlType).toBe('DATE');
  });

  it('infers DATETIME for datetime columns', () => {
    const result = parseClipboardText('created_at\n2024-01-01T10:00:00\n2024-06-15 12:30:00');
    expect(result.inferredColumns[0].sqlType).toBe('DATETIME');
  });

  it('defaults to TEXT for mixed types with low confidence', () => {
    const result = parseClipboardText('value\n123\nhello\n456');
    const col = result.inferredColumns[0];
    expect(col.sqlType).toBe('TEXT');
    expect(col.confidence).toBe('low');
  });

  it('promotes INTEGER+REAL mix to REAL', () => {
    const result = parseClipboardText('amount\n100\n29.99\n50');
    expect(result.inferredColumns[0].sqlType).toBe('REAL');
    expect(result.inferredColumns[0].confidence).toBe('high');
  });

  it('marks column as nullable when many empty values', () => {
    const result = parseClipboardText('name\toptional\nAlice\t\nBob\t\nCarol\t');
    const optCol = result.inferredColumns.find((c) => c.name === 'optional');
    expect(optCol?.nullable).toBe(true);
  });
});

describe('Header detection heuristic', () => {
  it('treats first row as header when values differ from data types', () => {
    const result = parseClipboardText('id\tname\tage\n1\tAlice\t30\n2\tBob\t25');
    expect(result.hasHeaderRow).toBe(true);
  });

  it('treats first row as data when all values match data type', () => {
    const result = parseClipboardText('1\t100\t200\n2\t300\t400\n3\t500\t600');
    expect(result.hasHeaderRow).toBe(false);
  });
});

describe('reParseWithHeaderOption', () => {
  it('re-extracts headers when toggling hasHeaderRow on', () => {
    const original = parseClipboardText('1\t2\n3\t4');
    const reparsed = reParseWithHeaderOption('1\t2\n3\t4', true, original);
    expect(reparsed.headers).toEqual(['1', '2']);
    expect(reparsed.rows).toHaveLength(1);
    expect(reparsed.hasHeaderRow).toBe(true);
  });

  it('generates col_N headers when toggling hasHeaderRow off', () => {
    const original = parseClipboardText('name\tage\nAlice\t30');
    const reparsed = reParseWithHeaderOption('name\tage\nAlice\t30', false, original);
    expect(reparsed.headers).toEqual(['col_1', 'col_2']);
    expect(reparsed.rows).toHaveLength(2);
  });
});

describe('column name guessing for headerless data', () => {
  it('hints at date, currency, barcode, amount, quantity and code columns', () => {
    // Same shape as a real headerless marketplace-settlement export.
    const result = parseClipboardText(
      'VTEC1;BSSM01;20260902;THB;9788836036493;-1;800.00;GW6PEG\n' +
        'VTEC1;BSSM01;20260903;THB;641628401505;-1;7000.00;DW6PEV',
    );
    expect(result.hasHeaderRow).toBe(false);
    expect(result.headers).toEqual([
      'col_1_code',
      'col_2_code',
      'col_3_date',
      'col_4_currency',
      'col_5_barcode',
      'col_6_qty',
      'col_7_amount',
      'col_8_code',
    ]);
  });

  it('falls back to plain col_N when values give no useful hint', () => {
    const result = parseClipboardText('true\tfalse\ntrue\tfalse');
    expect(result.hasHeaderRow).toBe(false);
    expect(result.headers).toEqual(['col_1', 'col_2']);
  });
});

describe('edge cases', () => {
  it('returns empty structure for empty input', () => {
    const result = parseClipboardText('   \n\n  ');
    expect(result.rowCount).toBe(0);
    expect(result.headers).toHaveLength(0);
  });

  it('skips empty rows and adds warning', () => {
    const result = parseClipboardText('name\tage\nAlice\t30\n\n\nBob\t25');
    expect(result.rowCount).toBe(2);
    expect(result.warnings.some((w) => w.includes('empty rows'))).toBe(true);
  });

  it('pads short rows with empty strings', () => {
    const result = parseClipboardText('a\tb\tc\n1\t2');
    expect(result.rows[0]).toHaveLength(3);
    expect(result.rows[0][2]).toBe('');
  });
});

describe('parseMultipleFiles', () => {
  it('merges rows from several files and appends a source_file column', () => {
    const result = parseMultipleFiles([
      { name: 'a.csv', text: 'id;name\n1;Alice\n2;Bob' },
      { name: 'b.csv', text: 'id;name\n3;Carol' },
    ]);
    expect(result.headers).toEqual(['id', 'name', 'source_file']);
    expect(result.rowCount).toBe(3);
    expect(result.rows[0]).toEqual(['1', 'Alice', 'a.csv']);
    expect(result.rows[2]).toEqual(['3', 'Carol', 'b.csv']);
  });

  it('pads/truncates rows and warns when a file has a different column count', () => {
    const result = parseMultipleFiles([
      { name: 'a.csv', text: '1;100;200\n2;300;400' },
      { name: 'b.csv', text: '3;500\n4;600' },
    ]);
    expect(result.headers).toEqual(['col_1_qty', 'col_2_qty', 'col_3_qty', 'source_file']);
    expect(result.rows[2]).toEqual(['3', '500', '', 'b.csv']);
    expect(result.warnings.some((w) => w.includes('b.csv'))).toBe(true);
  });

  it('avoids colliding with an existing source_file column', () => {
    const result = parseMultipleFiles([
      { name: 'a.csv', text: 'id;source_file\n1;x' },
    ]);
    expect(result.headers).toEqual(['id', 'source_file', 'source_file_1']);
  });

  it('applies a forced header option uniformly across files', () => {
    const result = parseMultipleFiles(
      [
        { name: 'a.csv', text: '1;2\n3;4' },
        { name: 'b.csv', text: '5;6\n7;8' },
      ],
      { hasHeaderRow: true },
    );
    expect(result.headers).toEqual(['1', '2', 'source_file']);
    expect(result.rows).toEqual([
      ['3', '4', 'a.csv'],
      ['7', '8', 'b.csv'],
    ]);
  });

  it('returns an empty structure for no files', () => {
    const result = parseMultipleFiles([]);
    expect(result.rowCount).toBe(0);
    expect(result.headers).toHaveLength(0);
  });
});

describe('parseMultipleFilesWithSchemas', () => {
  // Real shapes reported by the user: a 15-column "CN" export where column 4
  // is invoice_id and column 15 is delivery_order_id, vs. a 14-column "ABB"
  // export where column 4 IS delivery_order_id directly (no invoice_id at
  // all). Merging by position would wrongly file ABB's delivery_order_id
  // under the "invoice_id" header just because they share a column index.
  const cnColumns = [
    'prefix', 'store_code', 'register_id', 'invoice_id', 'orderdate',
    'cegid_id', 'currency', 'partner_item_id', 'quantity_per_line',
    'unit_price', 'total_price', 'total_price_afterdiscount',
    'markdown_code', 'unknown_col_14', 'delivery_order_id',
  ];
  const abbColumns = [
    'prefix', 'store_code', 'register_id', 'delivery_order_id', 'orderdate',
    'cegid_id', 'currency', 'partner_item_id', 'quantity_per_line',
    'unit_price', 'total_price', 'total_price_afterdiscount', 'markdown_code',
  ];

  const cnRow =
    'VTEC1 ;BSSM01;BSSM01;TOCN20260902000173506;20260902;WILAZTH;THB;9788836036493;-1;800.00;-800.00;0.00;GW6PEG;;TODOELM26080000847';
  const abbRow =
    'VTEC1 ;BLSM01;BLSM01;TODOLCC26080004208;20260831;WILAZTH;THB;3253581763773;1;34.00;34.00;0.00;GW6PLG;';

  it('detects the two distinct column-count shapes', () => {
    const counts = detectFileColumnCounts([
      { name: 'cn.csv', text: cnRow },
      { name: 'abb.csv', text: abbRow },
    ]);
    expect(counts.get(15)).toEqual(['cn.csv']);
    expect(counts.get(14)).toEqual(['abb.csv']);
  });

  it('aligns by column name instead of position across differing shapes', () => {
    const result = parseMultipleFilesWithSchemas(
      [
        { name: 'cn.csv', text: cnRow },
        { name: 'abb.csv', text: abbRow },
      ],
      { 15: cnColumns, 14: abbColumns },
    );

    // Union header: cn's 15 names (abb contributes none new) + source_file.
    expect(result.headers).toEqual([...cnColumns, 'source_file']);
    expect(result.rowCount).toBe(2);

    const invoiceIdx = result.headers.indexOf('invoice_id');
    const deliveryIdx = result.headers.indexOf('delivery_order_id');

    // CN row: invoice_id comes from column 4, delivery_order_id from column 15.
    expect(result.rows[0][invoiceIdx]).toBe('TOCN20260902000173506');
    expect(result.rows[0][deliveryIdx]).toBe('TODOELM26080000847');

    // ABB row: no invoice_id at all — must stay blank, not inherit column 4's
    // ABB value (which is actually its delivery_order_id).
    expect(result.rows[1][invoiceIdx]).toBe('');
    expect(result.rows[1][deliveryIdx]).toBe('TODOLCC26080004208');
  });

  it('falls back to guessed headers for a shape with no supplied schema', () => {
    const result = parseMultipleFilesWithSchemas(
      [{ name: 'unknown.csv', text: '1;2;3\n4;5;6' }],
      { 15: cnColumns },
    );
    expect(result.rowCount).toBe(2);
    expect(result.headers).not.toContain('invoice_id');
  });

  it('warns and drops extra columns when a supplied schema is shorter than the data', () => {
    const result = parseMultipleFilesWithSchemas(
      [{ name: 'abb.csv', text: abbRow }],
      { 14: abbColumns }, // abbColumns has 13 names for a 14-column row
    );
    expect(result.warnings.some((w) => w.includes('abb.csv'))).toBe(true);
    expect(result.headers).toEqual([...abbColumns, 'source_file']);
  });

  it('marks a column nullable even when only a minority shape lacks it', () => {
    // A first-N-rows sample would be entirely CN rows here (60 of them, all
    // with invoice_id populated) with the 40 ABB rows (which have no
    // invoice_id at all) never sampled — wrongly inferring NOT NULL and
    // later failing the real INSERT. The merge must sample across the whole
    // dataset, not just its front.
    const files = [
      { name: 'cn.csv', text: Array(60).fill(cnRow).join('\n') },
      { name: 'abb.csv', text: Array(40).fill(abbRow).join('\n') },
    ];
    const result = parseMultipleFilesWithSchemas(files, { 15: cnColumns, 14: abbColumns });
    const invoiceCol = result.inferredColumns.find((c) => c.name === 'invoice_id');
    expect(invoiceCol?.nullable).toBe(true);
  });
});
