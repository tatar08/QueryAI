import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseParityMatrix,
  parsePortStatus,
  reconcilePortStatus,
  isDynamicallyInvoked,
  formatViolations,
  CLASSIFIED_STATUSES,
} from '../../src/utils/parityMatrix';

/**
 * The browser-port coverage gate.
 *
 * `PLAN-01-parity-matrix.csv` is regenerated from `src-tauri/`, so it is authoritative
 * about which commands exist. `DEV-01-port-status.csv` records what Development has done
 * with each one. This suite fails when the two disagree — when a command is added without
 * being triaged, when a row is left unclassified, or when a row claims `ported` without a
 * file that actually serves it.
 *
 * The point is that "how much of the desktop app works in a browser" is answerable by
 * running the tests, not by reading a status report.
 */

const repoRoot = resolve(__dirname, '../..');
const MATRIX_PATH = 'planning/browser-port/PLAN-01-parity-matrix.csv';
const LEDGER_PATH = 'planning/browser-port/DEV-01-port-status.csv';

const readRepoFile = (relativePath: string): string =>
  readFileSync(resolve(repoRoot, relativePath), 'utf8');

/** Reads an evidence path, returning null when it does not exist. */
const resolveEvidence = (relativePath: string): string | null => {
  const absolute = resolve(repoRoot, relativePath);
  return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
};

const matrix = parseParityMatrix(readRepoFile(MATRIX_PATH));
const ledger = parsePortStatus(readRepoFile(LEDGER_PATH));
const report = reconcilePortStatus(matrix, ledger, resolveEvidence);

describe('browser port status', () => {
  describe('parity matrix', () => {
    it('should list every Tauri command exactly once', () => {
      const commands = matrix.map((row) => row.command);
      expect(new Set(commands).size).toBe(commands.length);
    });

    it('should not be empty', () => {
      expect(matrix.length).toBeGreaterThan(0);
    });

    it('should give every command a proposed endpoint and method', () => {
      const incomplete = matrix.filter(
        (row) => row.endpoint.trim() === '' || row.httpMethod.trim() === '',
      );
      expect(incomplete.map((row) => row.command)).toEqual([]);
    });

    it('should give every command a browser substitute', () => {
      const missing = matrix.filter((row) => row.browserSubstitute.trim() === '');
      expect(missing.map((row) => row.command)).toEqual([]);
    });
  });

  describe('reconciliation against the ledger', () => {
    it('should classify every command as ported, deferred, or dropped', () => {
      const unclassified = report.violations.filter(
        (violation) => violation.kind === 'unclassified',
      );
      expect(formatViolations(unclassified)).toBe('');
    });

    it('should have a ledger row for every command in the matrix', () => {
      const missing = report.violations.filter(
        (violation) => violation.kind === 'missing-status-row',
      );
      expect(formatViolations(missing)).toBe('');
    });

    it('should not carry ledger rows for commands that no longer exist', () => {
      const phantom = report.violations.filter(
        (violation) =>
          violation.kind === 'phantom-status-row' || violation.kind === 'duplicate-status-row',
      );
      expect(formatViolations(phantom)).toBe('');
    });

    it('should back every "ported" claim with a file that serves the command', () => {
      const unbacked = report.violations.filter(
        (violation) =>
          violation.kind === 'missing-evidence' || violation.kind === 'unresolved-evidence',
      );
      expect(formatViolations(unbacked)).toBe('');
    });

    it('should justify every deferred or dropped command in writing', () => {
      const unjustified = report.violations.filter(
        (violation) => violation.kind === 'missing-justification',
      );
      expect(formatViolations(unjustified)).toBe('');
    });

    it('should report no violations at all', () => {
      expect(formatViolations(report.violations)).toBe('');
    });
  });

  describe('coverage accounting', () => {
    it('should account for every command exactly once', () => {
      const { ported, deferred, dropped, unclassified, total } = report.summary;
      expect(ported + deferred + dropped + unclassified).toBe(total);
    });

    it('should use only classified statuses', () => {
      const statuses = new Set(ledger.map((row) => row.status));
      for (const status of statuses) {
        expect(CLASSIFIED_STATUSES).toContain(status);
      }
    });
  });

  describe('dynamic invoke hazard', () => {
    /**
     * `src/components/settings/AiTab.tsx` calls `invoke(cmd, ...)` with a computed name.
     * These commands have zero string-literal call sites, so a codemod over literal
     * invokes skips them and they fail at runtime with no compile error. The ledger must
     * keep them flagged.
     */
    const dynamicCommands = matrix.filter(isDynamicallyInvoked).map((row) => row.command);

    it('should still detect the dynamically invoked prompt commands', () => {
      expect(dynamicCommands.length).toBeGreaterThan(0);
    });

    it('should flag every dynamically invoked command in the ledger', () => {
      const unflagged = dynamicCommands.filter(
        (command) => !ledger.find((row) => row.command === command)?.dynamic,
      );
      expect(unflagged).toEqual([]);
    });

    it('should not flag commands that have literal call sites', () => {
      const overflagged = ledger
        .filter((row) => row.dynamic)
        .map((row) => row.command)
        .filter((command) => !dynamicCommands.includes(command));
      expect(overflagged).toEqual([]);
    });
  });
});
