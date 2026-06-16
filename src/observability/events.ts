// src/observability/events.ts — the --json contract: one JSON object per line (NDJSON) describing
// run lifecycle + each write as it happens, so CI/automation can follow a run in real time.
import type { AgentRunResult } from "../core/types.js";
import type { LedgerEntry } from "./ledger.js";

export type BouleEvent =
  | { type: "run_started"; runId: string; workflow: string; resumedFrom?: string }
  | { type: "write"; entry: LedgerEntry }
  | { type: "run_finished"; result: AgentRunResult };

export type Emit = (event: BouleEvent) => void;

/** In --json mode, stream NDJSON to stdout; otherwise a no-op (the human summary renders at the end). */
export function makeEmitter(json: boolean): Emit {
  if (!json) return () => {};
  return (event) => {
    process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
  };
}
