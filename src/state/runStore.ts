// src/state/runStore.ts — per-run artifacts under .boule/runs/<runId>/. Disposable local state;
// GitHub remains the source of truth. Holds the report + ledger now; checkpoints later (resume).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentRunResult } from "../core/types.js";
import type { Ledger, LedgerEntry } from "../observability/ledger.js";
import type { UndoReport } from "./undo.js";

const RUNS_ROOT = join(".boule", "runs");

export function runDir(runId: string): string {
  return join(process.cwd(), RUNS_ROOT, runId);
}

/** Enough to resume a run: the SDK session to reattach to, plus what was being asked. */
export interface Checkpoint {
  runId: string;
  sessionId: string;
  workflow: string;
  prompt: string;
  status: "running" | "success" | "failed";
  stopReason?: string;
  updatedAt: string;
}

export function saveCheckpoint(cp: Checkpoint): void {
  const dir = runDir(cp.runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "checkpoint.json"), `${JSON.stringify(cp, null, 2)}\n`);
}

export function loadCheckpoint(runId: string): Checkpoint | null {
  const path = join(runDir(runId), "checkpoint.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as Checkpoint;
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

/** Record that a run was reversed, so `runs` can flag it. */
export function persistUndo(runId: string, report: UndoReport): void {
  const dir = runDir(runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "undo.json"), `${JSON.stringify(report, null, 2)}\n`);
}

export function isUndone(runId: string): boolean {
  return existsSync(join(runDir(runId), "undo.json"));
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
