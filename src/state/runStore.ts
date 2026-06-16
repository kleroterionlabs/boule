// src/state/runStore.ts — per-run artifacts under .boule/runs/<runId>/. Disposable local state;
// GitHub remains the source of truth. Holds the report + ledger now; checkpoints later (resume).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentRunResult } from "../core/types.js";
import type { Ledger, LedgerEntry } from "../observability/ledger.js";

const RUNS_ROOT = join(".boule", "runs");

export function runDir(runId: string): string {
  return join(process.cwd(), RUNS_ROOT, runId);
}

/** Persist the result + full mutation ledger for a finished run. Returns the report path. */
export function persistRun(runId: string, report: AgentRunResult, ledger: Ledger): string {
  const dir = runDir(runId);
  mkdirSync(dir, { recursive: true });
  const reportPath = join(dir, "report.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const jsonl = ledger.entries.map((e) => JSON.stringify(e)).join("\n");
  writeFileSync(join(dir, "ledger.jsonl"), jsonl ? `${jsonl}\n` : "");
  return reportPath;
}

/** Read back a run's recorded mutations (for `boule undo`). Empty if the run is unknown. */
export function loadLedger(runId: string): LedgerEntry[] {
  const path = join(runDir(runId), "ledger.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as LedgerEntry);
}

/** Read back a run's report, or null if unknown. */
export function loadReport(runId: string): AgentRunResult | null {
  const path = join(runDir(runId), "report.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as AgentRunResult;
}

/** Run ids on disk, newest first (ULIDs sort lexicographically by time). */
export function listRunIds(): string[] {
  const root = join(process.cwd(), RUNS_ROOT);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse();
}
