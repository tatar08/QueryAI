/**
 * Browser-port parity matrix reconciliation.
 *
 * Two generated CSVs describe the Tauri IPC -> HTTP port:
 *
 * - `planning/browser-port/PLAN-01-parity-matrix.csv` — one row per `#[tauri::command]`,
 *   extracted from `src-tauri/`. This is the work queue and the source of truth for
 *   *what exists*.
 * - `planning/browser-port/DEV-01-port-status.csv` — one row per command recording what
 *   Development has actually done with it. This is the source of truth for *what is done*.
 *
 * The functions here reconcile the two so a claim of coverage can be checked instead of
 * trusted. A command may not be silently dropped, and a row may not claim `ported`
 * without naming a file that exists and mentions the command.
 */

/** Lifecycle state of a single command in the browser port. */
export type PortStatus = 'ported' | 'deferred' | 'dropped' | 'unclassified';

/** Statuses a row may legitimately carry once Development has triaged it. */
export const CLASSIFIED_STATUSES: readonly PortStatus[] = [
  'ported',
  'deferred',
  'dropped',
];

/** Risk classification assigned by the Planning inventory. */
export type ParityRisk = 'GREEN' | 'YELLOW' | 'RED';

/** One row of `PLAN-01-parity-matrix.csv`. */
export interface ParityRow {
  command: string;
  /** `file.rs:line` of the `#[tauri::command]` definition. */
  source: string;
  /** Whether the command appears in the `generate_handler!` block. */
  registered: boolean;
  /** Number of string-literal `invoke("name")` sites in the frontend. */
  frontendCallSites: number;
  httpMethod: string;
  /** Proposed endpoint path. A naming proposal, not a ratified API. */
  endpoint: string;
  risk: ParityRisk;
  riskReason: string;
  browserSubstitute: string;
}

/** One row of `DEV-01-port-status.csv`. */
export interface PortStatusRow {
  command: string;
  status: PortStatus;
  /** Repo-relative path proving the command is served. Required when `ported`. */
  evidence: string;
  /** Why the command is not ported. Required when `deferred` or `dropped`. */
  justification: string;
  /**
   * Whether the command is reached only through a computed `invoke(cmd, ...)` name.
   * These have zero literal call sites and are invisible to any codemod that rewrites
   * string-literal invokes — see `src/components/settings/AiTab.tsx`.
   */
  dynamic: boolean;
}

/** A single reconciliation failure, addressed to whoever must fix it. */
export interface ParityViolation {
  command: string;
  kind:
    | 'missing-status-row'
    | 'phantom-status-row'
    | 'duplicate-status-row'
    | 'unclassified'
    | 'missing-evidence'
    | 'unresolved-evidence'
    | 'missing-justification';
  detail: string;
}

/** Count of commands per status, plus the matrix total they must sum to. */
export interface PortStatusSummary {
  ported: number;
  deferred: number;
  dropped: number;
  unclassified: number;
  total: number;
}

export interface ReconciliationReport {
  violations: ParityViolation[];
  summary: PortStatusSummary;
}

/**
 * Resolves an evidence path to the text of the file it names, or `null` when the path
 * does not exist. Injected so the reconciliation logic stays free of filesystem access.
 */
export type EvidenceResolver = (path: string) => string | null;

/**
 * Parses RFC 4180 style CSV. Fields may be quoted; a quoted field may contain commas,
 * newlines, and doubled quotes. The generated matrices use all three.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldWasQuoted = false;

  const endField = (): void => {
    row.push(field);
    field = '';
    fieldWasQuoted = false;
  };

  const endRow = (): void => {
    endField();
    // A trailing newline produces a final empty row; drop it rather than emit a phantom.
    if (row.length > 1 || row[0] !== '') {
      rows.push(row);
    }
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === '' && !fieldWasQuoted) {
      inQuotes = true;
      fieldWasQuoted = true;
    } else if (char === ',') {
      endField();
    } else if (char === '\n') {
      endRow();
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    endRow();
  }

  return rows;
}

/** Serialises rows back to CSV, quoting only fields that need it. */
export function toCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) =>
          /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell,
        )
        .join(','),
    )
    .join('\n');
}

function parseRisk(value: string): ParityRisk {
  if (value === 'GREEN' || value === 'YELLOW' || value === 'RED') return value;
  throw new Error(`Unknown risk classification: "${value}"`);
}

/** Parses `PLAN-01-parity-matrix.csv`. Throws when a row is structurally wrong. */
export function parseParityMatrix(text: string): ParityRow[] {
  const [header, ...body] = parseCsv(text);
  if (!header || header[0] !== 'command') {
    throw new Error('Parity matrix is missing its "command" header column');
  }

  return body.map((cells, index) => {
    if (cells.length !== header.length) {
      throw new Error(
        `Parity matrix row ${index + 2} has ${cells.length} fields, expected ${header.length}`,
      );
    }
    const callSites = Number.parseInt(cells[3], 10);
    return {
      command: cells[0],
      source: cells[1],
      registered: cells[2] === 'yes',
      frontendCallSites: Number.isNaN(callSites) ? 0 : callSites,
      httpMethod: cells[5],
      endpoint: cells[6],
      risk: parseRisk(cells[7]),
      riskReason: cells[8],
      browserSubstitute: cells[9],
    };
  });
}

function parseStatus(value: string): PortStatus {
  if (
    value === 'ported' ||
    value === 'deferred' ||
    value === 'dropped' ||
    value === 'unclassified'
  ) {
    return value;
  }
  throw new Error(`Unknown port status: "${value}"`);
}

/** Parses `DEV-01-port-status.csv`. Throws when a row is structurally wrong. */
export function parsePortStatus(text: string): PortStatusRow[] {
  const [header, ...body] = parseCsv(text);
  if (!header || header[0] !== 'command') {
    throw new Error('Port status ledger is missing its "command" header column');
  }

  return body.map((cells, index) => {
    if (cells.length !== header.length) {
      throw new Error(
        `Port status row ${index + 2} has ${cells.length} fields, expected ${header.length}`,
      );
    }
    return {
      command: cells[0],
      status: parseStatus(cells[1]),
      evidence: cells[2],
      justification: cells[3],
      dynamic: cells[4] === 'yes',
    };
  });
}

export function summarizePortStatus(
  rows: PortStatusRow[],
  total: number,
): PortStatusSummary {
  const count = (status: PortStatus): number =>
    rows.filter((row) => row.status === status).length;

  return {
    ported: count('ported'),
    deferred: count('deferred'),
    dropped: count('dropped'),
    unclassified: count('unclassified'),
    total,
  };
}

/**
 * Reconciles the ledger against the matrix.
 *
 * Every command must be classified exactly once, every `ported` claim must point at a
 * file that exists and mentions the command, and every `deferred` or `dropped` row must
 * carry a written reason. A command added to `src-tauri/` without a ledger entry shows up
 * as `missing-status-row`, which is how matrix drift becomes a test failure rather than a
 * surprise at runtime.
 */
export function reconcilePortStatus(
  matrix: ParityRow[],
  statusRows: PortStatusRow[],
  resolveEvidence: EvidenceResolver,
): ReconciliationReport {
  const violations: ParityViolation[] = [];
  const byCommand = new Map<string, PortStatusRow[]>();

  for (const row of statusRows) {
    const existing = byCommand.get(row.command);
    if (existing) {
      existing.push(row);
    } else {
      byCommand.set(row.command, [row]);
    }
  }

  const matrixCommands = new Set(matrix.map((row) => row.command));

  for (const command of matrixCommands) {
    if (!byCommand.has(command)) {
      violations.push({
        command,
        kind: 'missing-status-row',
        detail:
          'Command exists in the parity matrix but has no row in the port status ledger. ' +
          'Run `pnpm port:status` to seed it, then classify it.',
      });
    }
  }

  for (const [command, rows] of byCommand) {
    if (!matrixCommands.has(command)) {
      violations.push({
        command,
        kind: 'phantom-status-row',
        detail:
          'Ledger row refers to a command that is not in the parity matrix. ' +
          'Either the command was removed from src-tauri/ or the name is misspelled.',
      });
      continue;
    }

    if (rows.length > 1) {
      violations.push({
        command,
        kind: 'duplicate-status-row',
        detail: `Command is listed ${rows.length} times in the ledger; it must appear exactly once.`,
      });
    }

    for (const row of rows) {
      if (row.status === 'unclassified') {
        violations.push({
          command,
          kind: 'unclassified',
          detail:
            'Every command must be ported, deferred, or dropped. No row may be left unclassified.',
        });
        continue;
      }

      if (row.status === 'ported') {
        if (row.evidence.trim() === '') {
          violations.push({
            command,
            kind: 'missing-evidence',
            detail:
              'Row claims "ported" but names no evidence file. A coverage claim must be checkable.',
          });
          continue;
        }

        const contents = resolveEvidence(row.evidence);
        if (contents === null) {
          violations.push({
            command,
            kind: 'unresolved-evidence',
            detail: `Evidence path "${row.evidence}" does not exist.`,
          });
        } else if (!contents.includes(command)) {
          violations.push({
            command,
            kind: 'unresolved-evidence',
            detail: `Evidence file "${row.evidence}" does not mention "${command}".`,
          });
        }
        continue;
      }

      if (row.justification.trim() === '') {
        violations.push({
          command,
          kind: 'missing-justification',
          detail: `Row is "${row.status}" but carries no written justification.`,
        });
      }
    }
  }

  return {
    violations,
    summary: summarizePortStatus(statusRows, matrix.length),
  };
}

/**
 * Commands reached only through a computed `invoke(cmd, ...)` name in
 * `src/components/settings/AiTab.tsx`. They have zero string-literal call sites, so any
 * codemod that rewrites literal invokes skips them and breaks them with no compile error.
 * Detected from the matrix rather than hard-coded, so a new dynamic prompt command is
 * picked up automatically.
 */
export function isDynamicallyInvoked(row: ParityRow): boolean {
  return /^(save|reset)_[a-z]+_prompt$/.test(row.command) && row.frontendCallSites === 0;
}

/**
 * Derives the initial ledger entry for a command that has not been triaged yet.
 *
 * Commands whose planned substitute is "Drop" are dropped outright — porting them would
 * add permanent surface area on a network boundary for behaviour a browser already has.
 * Everything else starts `deferred`: not done, with the planned substitute recorded so the
 * reason survives without needing the matrix alongside it.
 */
export function seedStatusRow(row: ParityRow): PortStatusRow {
  const dropped = row.browserSubstitute.startsWith('Drop');
  return {
    command: row.command,
    status: dropped ? 'dropped' : 'deferred',
    evidence: '',
    justification: dropped
      ? row.browserSubstitute
      : `Not yet served over HTTP. Planned substitute: ${row.browserSubstitute}`,
    dynamic: isDynamicallyInvoked(row),
  };
}

/**
 * Merges the matrix into an existing ledger, preserving every decision already recorded.
 *
 * Commands new to the matrix are appended as `unclassified` so they fail reconciliation
 * until someone triages them — silence is not allowed to read as coverage. Rows whose
 * command no longer exists are kept, so the phantom shows up as a violation instead of
 * being quietly erased.
 */
export function mergePortStatus(
  matrix: ParityRow[],
  existing: PortStatusRow[],
): PortStatusRow[] {
  const known = new Map(existing.map((row) => [row.command, row]));
  const merged: PortStatusRow[] = [];

  for (const row of matrix) {
    const current = known.get(row.command);
    if (current) {
      // Keep the recorded decision, but let the matrix stay authoritative about which
      // commands are dynamically invoked.
      merged.push({ ...current, dynamic: isDynamicallyInvoked(row) });
      known.delete(row.command);
    } else if (existing.length === 0) {
      merged.push(seedStatusRow(row));
    } else {
      merged.push({
        command: row.command,
        status: 'unclassified',
        evidence: '',
        justification: '',
        dynamic: isDynamicallyInvoked(row),
      });
    }
  }

  // Retain rows the matrix no longer knows about so reconciliation can report them.
  for (const orphan of known.values()) {
    merged.push(orphan);
  }

  return merged.sort((a, b) => a.command.localeCompare(b.command));
}

/** Column order of `DEV-01-port-status.csv`. */
export const PORT_STATUS_HEADER = [
  'command',
  'status',
  'evidence',
  'justification',
  'dynamic',
];

export function serializePortStatus(rows: PortStatusRow[]): string {
  return `${toCsv([
    PORT_STATUS_HEADER,
    ...rows.map((row) => [
      row.command,
      row.status,
      row.evidence,
      row.justification,
      row.dynamic ? 'yes' : 'no',
    ]),
  ])}\n`;
}

/** Formats violations as a stable, greppable block for test failure output. */
export function formatViolations(violations: ParityViolation[]): string {
  return violations
    .slice()
    .sort((a, b) => a.command.localeCompare(b.command))
    .map((violation) => `  [${violation.kind}] ${violation.command}: ${violation.detail}`)
    .join('\n');
}
