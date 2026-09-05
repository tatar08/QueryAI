#!/usr/bin/env node
/**
 * Seeds and refreshes `planning/browser-port/DEV-01-port-status.csv` from
 * `planning/browser-port/PLAN-01-parity-matrix.csv`.
 *
 * Existing decisions are preserved. Commands new to the matrix are appended as
 * `unclassified`, which fails `tests/browser-port/portStatus.test.ts` until someone
 * triages them — that is the point: a command cannot enter the codebase and quietly
 * count as covered.
 *
 * Usage: pnpm port:status
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Node >= 23.6 strips TypeScript types natively, so the shared logic in src/utils can be
// imported here without a build step. See .node-version.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MATRIX_PATH = resolve(repoRoot, 'planning/browser-port/PLAN-01-parity-matrix.csv');
const LEDGER_PATH = resolve(repoRoot, 'planning/browser-port/DEV-01-port-status.csv');

const { parseParityMatrix, parsePortStatus, mergePortStatus, serializePortStatus } =
  await import('../src/utils/parityMatrix.ts');

const matrix = parseParityMatrix(readFileSync(MATRIX_PATH, 'utf8'));
const existing = existsSync(LEDGER_PATH)
  ? parsePortStatus(readFileSync(LEDGER_PATH, 'utf8'))
  : [];

const merged = mergePortStatus(matrix, existing);
writeFileSync(LEDGER_PATH, serializePortStatus(merged), 'utf8');

const counts = merged.reduce((acc, row) => {
  acc[row.status] = (acc[row.status] ?? 0) + 1;
  return acc;
}, {});

console.log(`Wrote ${merged.length} rows to planning/browser-port/DEV-01-port-status.csv`);
for (const [status, count] of Object.entries(counts).sort()) {
  console.log(`  ${status}: ${count}`);
}
if (counts.unclassified) {
  console.log(
    `\n${counts.unclassified} command(s) need triage. Set each to ported, deferred, or dropped.`,
  );
  process.exitCode = 1;
}
