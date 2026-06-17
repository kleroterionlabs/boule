// src/core/types.ts — GitHub-agnostic domain lingua franca. Imports nothing with side effects.
// ArtifactKind + Fingerprint are single-sourced from @kleroterion/koine; all other domain types below
// stay Boule-specific. Imported locally (for use within this file) and re-exported for callers.
import type { ArtifactKind, Fingerprint } from "@kleroterion/koine";

export type { ArtifactKind, Fingerprint };

export type MoscowPriority = "must" | "should" | "could" | "wont";

/** Canonical field values written to a Projects v2 item, keyed by taxonomy names. */
export interface ProjectFieldValues {
  readonly Status?: string;
  readonly Kind?: string;
  readonly Priority?: string;
  readonly RICE?: number;
  readonly WSJF?: number;
  readonly MoSCoW?: MoscowPriority;
}

export interface Artifact {
  readonly kind: ArtifactKind;
  readonly bouleId: string; // e.g. "req:auth-otp-signin"
  readonly title: string;
  readonly body: string; // GitHub-flavored markdown (sans boule block)
  readonly labels: readonly string[];
  readonly parent?: string; // parent bouleId, resolved to node id at write time
  readonly fingerprint: Fingerprint; // content hash → idempotency
  readonly project?: ProjectFieldValues;
}

// ── Handles to GitHub objects (post-persistence) ──────────────────────────────
export interface IssueRef {
  number: number;
  nodeId: string;
  url: string;
}
export interface ProjectRef {
  number: number;
  nodeId: string;
  fields: Record<string, FieldRef>;
}
export interface DiscussionRef {
  number: number;
  nodeId: string;
  url: string;
}
export interface FieldRef {
  id: string;
  kind: "TEXT" | "NUMBER" | "DATE" | "SINGLE_SELECT" | "ITERATION";
  options?: Record<string, string>; // optionName → optionId for single-selects
}

export type UpsertAction = "create" | "update" | "noop";

export interface UpsertResult {
  action: UpsertAction;
  ref: IssueRef;
  fingerprint: Fingerprint;
}

export type StopReason =
  | "success"
  | "error_max_turns"
  | "error_max_budget_usd"
  | "error_during_execution"
  | "halted";

/** Counts of GitHub mutations a run performed, derived from the ledger. */
export interface RunMetrics {
  issuesCreated: number;
  issuesUpdated: number;
  issuesNoop: number;
  issuesClosed: number;
  subIssuesLinked: number;
  projectItems: number;
  projectItemsRemoved: number;
  fieldSets: number;
  discussionsPosted: number;
}

export interface AgentRunResult {
  ok: boolean;
  runId: string;
  sessionId?: string; // SDK session, for `boule resume`
  resumedFrom?: string; // runId this run continued, if any
  workflow: string;
  artifactsPlanned: number;
  artifactsWritten: IssueRef[];
  skippedDuplicates: string[]; // bouleIds
  metrics: RunMetrics;
  costUsd: number;
  modelUsage: Record<string, { inputTokens: number; outputTokens: number; costUsd: number }>;
  numTurns: number;
  stopReason: StopReason;
  errors: string[];
}
