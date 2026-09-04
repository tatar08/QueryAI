import { describe, it, expect } from 'vitest';
import {
  parseCsv,
  toCsv,
  parseParityMatrix,
  parsePortStatus,
  summarizePortStatus,
  reconcilePortStatus,
  isDynamicallyInvoked,
  seedStatusRow,
  mergePortStatus,
  serializePortStatus,
  formatViolations,
  type ParityRow,
  type PortStatusRow,
} from '../../src/utils/parityMatrix';

const MATRIX_HEADER =
  'command,source,registered,fe_call_sites,fe_first_site,http_method,endpoint,risk,risk_reason,browser_substitute';

const greenRow = (command: string, callSites = 1): string =>
  `${command},commands.rs:10,yes,${callSites},src/App.tsx:1,POST,/api/db/${command},GREEN,pure request/response,Direct HTTP endpoint`;

const matrixRow = (overrides: Partial<ParityRow> = {}): ParityRow => ({
  command: 'list_tables',
  source: 'commands.rs:10',
  registered: true,
  frontendCallSites: 1,
  httpMethod: 'POST',
  endpoint: '/api/db/list-tables',
  risk: 'GREEN',
  riskReason: 'pure request/response',
  browserSubstitute: 'Direct HTTP endpoint',
  ...overrides,
});

const statusRow = (overrides: Partial<PortStatusRow> = {}): PortStatusRow => ({
  command: 'list_tables',
  status: 'deferred',
  evidence: '',
  justification: 'Not yet served over HTTP.',
  dynamic: false,
  ...overrides,
});

describe('parityMatrix', () => {
  describe('parseCsv', () => {
    it('should parse a plain row', () => {
      expect(parseCsv('a,b,c')).toEqual([['a', 'b', 'c']]);
    });

    it('should parse multiple rows', () => {
      expect(parseCsv('a,b\nc,d')).toEqual([
        ['a', 'b'],
        ['c', 'd'],
      ]);
    });

    it('should keep commas inside quoted fields', () => {
      expect(parseCsv('a,"b,c",d')).toEqual([['a', 'b,c', 'd']]);
    });

    it('should unescape doubled quotes', () => {
      expect(parseCsv('a,"say ""hi""",c')).toEqual([['a', 'say "hi"', 'c']]);
    });

    it('should keep newlines inside quoted fields', () => {
      expect(parseCsv('a,"line1\nline2"')).toEqual([['a', 'line1\nline2']]);
    });

    it('should preserve empty fields', () => {
      expect(parseCsv('a,,c')).toEqual([['a', '', 'c']]);
    });

    it('should ignore a trailing newline', () => {
      expect(parseCsv('a,b\n')).toEqual([['a', 'b']]);
    });

    it('should tolerate CRLF line endings', () => {
      expect(parseCsv('a,b\r\nc,d')).toEqual([
        ['a', 'b'],
        ['c', 'd'],
      ]);
    });

    it('should return an empty array for empty input', () => {
      expect(parseCsv('')).toEqual([]);
    });
  });

  describe('toCsv', () => {
    it('should leave simple fields unquoted', () => {
      expect(toCsv([['a', 'b']])).toBe('a,b');
    });

    it('should quote fields containing a comma', () => {
      expect(toCsv([['a', 'b,c']])).toBe('a,"b,c"');
    });

    it('should escape embedded quotes', () => {
      expect(toCsv([['say "hi"']])).toBe('"say ""hi"""');
    });

    it('should round-trip through parseCsv', () => {
      const rows = [
        ['command', 'note'],
        ['drop_it', 'Drop — devtools, natively'],
        ['keep_it', 'say "hi"'],
      ];
      expect(parseCsv(toCsv(rows))).toEqual(rows);
    });
  });

  describe('parseParityMatrix', () => {
    it('should parse a well-formed row', () => {
      const rows = parseParityMatrix(`${MATRIX_HEADER}\n${greenRow('list_tables', 3)}`);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        command: 'list_tables',
        registered: true,
        frontendCallSites: 3,
        risk: 'GREEN',
      });
    });

    it('should treat a non-numeric call site count as zero', () => {
      const row = greenRow('list_tables').replace(',yes,1,', ',yes,,');
      expect(parseParityMatrix(`${MATRIX_HEADER}\n${row}`)[0].frontendCallSites).toBe(0);
    });

    it('should mark unregistered commands', () => {
      const row = greenRow('list_tables').replace(',yes,', ',no,');
      expect(parseParityMatrix(`${MATRIX_HEADER}\n${row}`)[0].registered).toBe(false);
    });

    it('should throw when the header is wrong', () => {
      expect(() => parseParityMatrix('name,source\nfoo,bar')).toThrow(/command.*header/);
    });

    it('should throw on an unknown risk value', () => {
      const row = greenRow('list_tables').replace(',GREEN,', ',PURPLE,');
      expect(() => parseParityMatrix(`${MATRIX_HEADER}\n${row}`)).toThrow(/PURPLE/);
    });

    it('should throw when a row has the wrong field count', () => {
      expect(() => parseParityMatrix(`${MATRIX_HEADER}\na,b,c`)).toThrow(/expected 10/);
    });
  });

  describe('parsePortStatus', () => {
    const header = 'command,status,evidence,justification,dynamic';

    it('should parse a deferred row', () => {
      const rows = parsePortStatus(`${header}\nlist_tables,deferred,,not done yet,no`);
      expect(rows[0]).toEqual({
        command: 'list_tables',
        status: 'deferred',
        evidence: '',
        justification: 'not done yet',
        dynamic: false,
      });
    });

    it('should parse the dynamic flag', () => {
      const rows = parsePortStatus(`${header}\nsave_system_prompt,deferred,,pending,yes`);
      expect(rows[0].dynamic).toBe(true);
    });

    it('should throw on an unknown status', () => {
      expect(() => parsePortStatus(`${header}\nlist_tables,maybe,,,no`)).toThrow(/maybe/);
    });

    it('should throw when the header is wrong', () => {
      expect(() => parsePortStatus('cmd,status\nfoo,ported')).toThrow(/command.*header/);
    });
  });

  describe('isDynamicallyInvoked', () => {
    it('should flag a prompt command with no literal call sites', () => {
      expect(
        isDynamicallyInvoked(matrixRow({ command: 'save_system_prompt', frontendCallSites: 0 })),
      ).toBe(true);
    });

    it('should not flag a prompt command that has literal call sites', () => {
      expect(
        isDynamicallyInvoked(matrixRow({ command: 'save_system_prompt', frontendCallSites: 2 })),
      ).toBe(false);
    });

    it('should not flag an unrelated command with no call sites', () => {
      expect(
        isDynamicallyInvoked(matrixRow({ command: 'get_theme', frontendCallSites: 0 })),
      ).toBe(false);
    });
  });

  describe('seedStatusRow', () => {
    it('should drop commands whose substitute begins with Drop', () => {
      const row = seedStatusRow(
        matrixRow({ command: 'open_devtools', browserSubstitute: 'Drop — browser has devtools' }),
      );
      expect(row.status).toBe('dropped');
      expect(row.justification).toBe('Drop — browser has devtools');
    });

    it('should defer everything else and record the planned substitute', () => {
      const row = seedStatusRow(matrixRow());
      expect(row.status).toBe('deferred');
      expect(row.justification).toContain('Direct HTTP endpoint');
      expect(row.evidence).toBe('');
    });
  });

  describe('mergePortStatus', () => {
    it('should seed every command when the ledger is empty', () => {
      const merged = mergePortStatus([matrixRow(), matrixRow({ command: 'list_views' })], []);
      expect(merged).toHaveLength(2);
      expect(merged.every((row) => row.status === 'deferred')).toBe(true);
    });

    it('should preserve decisions already recorded', () => {
      const existing = [statusRow({ status: 'ported', evidence: 'src-web-server/src/lib.rs' })];
      const merged = mergePortStatus([matrixRow()], existing);
      expect(merged[0].status).toBe('ported');
      expect(merged[0].evidence).toBe('src-web-server/src/lib.rs');
    });

    it('should append a new command as unclassified once the ledger exists', () => {
      const merged = mergePortStatus(
        [matrixRow(), matrixRow({ command: 'brand_new_command' })],
        [statusRow()],
      );
      const added = merged.find((row) => row.command === 'brand_new_command');
      expect(added?.status).toBe('unclassified');
    });

    it('should refresh the dynamic flag from the matrix', () => {
      const merged = mergePortStatus(
        [matrixRow({ command: 'save_system_prompt', frontendCallSites: 0 })],
        [statusRow({ command: 'save_system_prompt', dynamic: false })],
      );
      expect(merged[0].dynamic).toBe(true);
    });

    it('should keep a row whose command left the matrix so it can be reported', () => {
      const merged = mergePortStatus([matrixRow()], [statusRow(), statusRow({ command: 'gone' })]);
      expect(merged.map((row) => row.command)).toContain('gone');
    });

    it('should sort rows by command name', () => {
      const merged = mergePortStatus(
        [matrixRow({ command: 'zeta' }), matrixRow({ command: 'alpha' })],
        [],
      );
      expect(merged.map((row) => row.command)).toEqual(['alpha', 'zeta']);
    });
  });

  describe('serializePortStatus', () => {
    it('should round-trip through parsePortStatus', () => {
      const rows = [
        statusRow({ command: 'a_cmd', justification: 'reason, with comma' }),
        statusRow({ command: 'b_cmd', status: 'ported', evidence: 'src/x.rs', justification: '' }),
      ];
      expect(parsePortStatus(serializePortStatus(rows))).toEqual(rows);
    });

    it('should end with a trailing newline', () => {
      expect(serializePortStatus([statusRow()]).endsWith('\n')).toBe(true);
    });
  });

  describe('summarizePortStatus', () => {
    it('should count each status', () => {
      const summary = summarizePortStatus(
        [
          statusRow({ command: 'a', status: 'ported' }),
          statusRow({ command: 'b', status: 'deferred' }),
          statusRow({ command: 'c', status: 'dropped' }),
          statusRow({ command: 'd', status: 'unclassified' }),
        ],
        4,
      );
      expect(summary).toEqual({ ported: 1, deferred: 1, dropped: 1, unclassified: 1, total: 4 });
    });
  });

  describe('reconcilePortStatus', () => {
    const noEvidence = () => null;
    const evidenceContaining = (text: string) => () => text;

    it('should report no violations for a clean ledger', () => {
      const report = reconcilePortStatus([matrixRow()], [statusRow()], noEvidence);
      expect(report.violations).toEqual([]);
    });

    it('should report a command with no ledger row', () => {
      const report = reconcilePortStatus([matrixRow()], [], noEvidence);
      expect(report.violations).toHaveLength(1);
      expect(report.violations[0].kind).toBe('missing-status-row');
    });

    it('should report a ledger row for a command that no longer exists', () => {
      const report = reconcilePortStatus([], [statusRow()], noEvidence);
      expect(report.violations[0].kind).toBe('phantom-status-row');
    });

    it('should report a duplicated command', () => {
      const report = reconcilePortStatus([matrixRow()], [statusRow(), statusRow()], noEvidence);
      expect(report.violations.some((v) => v.kind === 'duplicate-status-row')).toBe(true);
    });

    it('should report an unclassified row', () => {
      const report = reconcilePortStatus(
        [matrixRow()],
        [statusRow({ status: 'unclassified', justification: '' })],
        noEvidence,
      );
      expect(report.violations[0].kind).toBe('unclassified');
    });

    it('should reject a ported claim with no evidence path', () => {
      const report = reconcilePortStatus(
        [matrixRow()],
        [statusRow({ status: 'ported', evidence: '  ' })],
        noEvidence,
      );
      expect(report.violations[0].kind).toBe('missing-evidence');
    });

    it('should reject a ported claim whose evidence file is absent', () => {
      const report = reconcilePortStatus(
        [matrixRow()],
        [statusRow({ status: 'ported', evidence: 'src-web-server/src/lib.rs' })],
        noEvidence,
      );
      expect(report.violations[0].kind).toBe('unresolved-evidence');
      expect(report.violations[0].detail).toContain('does not exist');
    });

    it('should reject a ported claim whose evidence file omits the command', () => {
      const report = reconcilePortStatus(
        [matrixRow()],
        [statusRow({ status: 'ported', evidence: 'src-web-server/src/lib.rs' })],
        evidenceContaining('fn unrelated_handler() {}'),
      );
      expect(report.violations[0].kind).toBe('unresolved-evidence');
      expect(report.violations[0].detail).toContain('does not mention');
    });

    it('should accept a ported claim backed by a file naming the command', () => {
      const report = reconcilePortStatus(
        [matrixRow()],
        [statusRow({ status: 'ported', evidence: 'src-web-server/src/lib.rs' })],
        evidenceContaining('async fn list_tables() {}'),
      );
      expect(report.violations).toEqual([]);
    });

    it('should require a justification for a deferred row', () => {
      const report = reconcilePortStatus(
        [matrixRow()],
        [statusRow({ justification: '   ' })],
        noEvidence,
      );
      expect(report.violations[0].kind).toBe('missing-justification');
    });

    it('should require a justification for a dropped row', () => {
      const report = reconcilePortStatus(
        [matrixRow()],
        [statusRow({ status: 'dropped', justification: '' })],
        noEvidence,
      );
      expect(report.violations[0].kind).toBe('missing-justification');
    });

    it('should summarize against the matrix total', () => {
      const report = reconcilePortStatus(
        [matrixRow(), matrixRow({ command: 'list_views' })],
        [statusRow()],
        noEvidence,
      );
      expect(report.summary.total).toBe(2);
      expect(report.summary.deferred).toBe(1);
    });
  });

  describe('formatViolations', () => {
    it('should sort by command and include the kind', () => {
      const output = formatViolations([
        { command: 'zeta', kind: 'unclassified', detail: 'z' },
        { command: 'alpha', kind: 'missing-evidence', detail: 'a' },
      ]);
      expect(output.indexOf('alpha')).toBeLessThan(output.indexOf('zeta'));
      expect(output).toContain('[missing-evidence] alpha: a');
    });

    it('should return an empty string for no violations', () => {
      expect(formatViolations([])).toBe('');
    });
  });
});
