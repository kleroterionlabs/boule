// src/observability/ledger.ts — records every GitHub mutation in a run. The audit trail + the
// data source for the per-run report, the Daily Status body, and `boule undo`.
import type { IssueRef, RunMetrics } from "../core/types.js";

export type LedgerAction =
  | "issue.create"
  | "issue.update"
  | "issue.noop"
  | "subissue.link"
  | "project.item"
  | "project.field"
  | "discussion.create"
  | "discussion.update";

export interface LedgerEntry {
  ts: string;
  action: LedgerAction;
  bouleId?: string;
  number?: number;
  nodeId?: string;
  url?: string;
  itemId?: string;
  hash?: string;
}

export function emptyMetrics(): RunMetrics {
  return {
    issuesCreated: 0,
    issuesUpdated: 0,
    issuesNoop: 0,
    subIssuesLinked: 0,
    projectItems: 0,
    fieldSets: 0,
    discussionsPosted: 0,
  };
}

/** Append-only record of a run's GitHub mutations. */
export class Ledger {
  readonly entries: LedgerEntry[] = [];

  record(entry: Omit<LedgerEntry, "ts">): void {
    this.entries.push({ ts: new Date().toISOString(), ...entry });
  }

  metrics(): RunMetrics {
    const count = (a: LedgerAction): number => this.entries.filter((e) => e.action === a).length;
    return {
      issuesCreated: count("issue.create"),
      issuesUpdated: count("issue.update"),
      issuesNoop: count("issue.noop"),
      subIssuesLinked: count("subissue.link"),
      projectItems: count("project.item"),
      fieldSets: count("project.field"),
      discussionsPosted: count("discussion.create") + count("discussion.update"),
    };
  }

  /** Issues actually created or updated this run (for AgentRunResult.artifactsWritten). */
  writtenRefs(): IssueRef[] {
    return this.entries
      .filter((e) => (e.action === "issue.create" || e.action === "issue.update") && e.number != null)
      .map((e) => ({ number: e.number as number, nodeId: e.nodeId ?? "", url: e.url ?? "" }));
  }
}
