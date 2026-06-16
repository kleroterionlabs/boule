// src/core/taxonomy.ts — never hardcode taxonomy strings elsewhere; import from here.
import type { ArtifactKind } from "./types.js";

export const ISSUE_TYPE_NAMES = {
  design: "Design",
  requirement: "Requirement",
  competitor: "Competitor",
  market: "Market",
  gap: "Gap",
  epic: "Epic",
  feature: "Feature",
  task: "Task",
  spike: "Spike",
} as const;

/** Fallback kind labels used when native Issue Types are unavailable. */
export const kindLabel = (kind: ArtifactKind): string => `kind:${kind}`;

export const OPERATIONAL_LABELS = {
  managed: "boule:managed",
  needsHuman: "boule:needs-human",
  superseded: "boule:superseded",
  /** Kill-switch: an OPEN issue carrying this label halts all Boule writes. Close it to resume. */
  halt: "boule:halt",
} as const;

// TWO distinct status models — do not conflate:
//  • STATUS_LABELS (here)  = an artifact's ACCEPTANCE lifecycle, carried on the Issue as a label.
//  • STATUS_OPTIONS (below) = the WORKFLOW column on the Projects v2 board (the source of truth for
//    where work sits). The board field drives planning; the label records review state on the issue.
export const STATUS_LABELS = [
  "status:draft",
  "status:needs-review",
  "status:accepted",
  "status:superseded",
] as const;

export const PRIORITY_LABELS = [
  "priority:must",
  "priority:should",
  "priority:could",
  "priority:wont",
] as const;

/** Projects v2 custom field names (canonical keys used in ProjectFieldValues). */
export const PROJECT_FIELDS = {
  status: "Status",
  kind: "Kind",
  priority: "Priority",
  rice: "RICE",
  wsjf: "WSJF",
  moscow: "MoSCoW",
  iteration: "Iteration",
} as const;

export const STATUS_OPTIONS = [
  "Triage",
  "In Design",
  "In Review",
  "Ready",
  "In Progress",
  "Blocked",
  "Done",
] as const;

export const DISCUSSION_CATEGORIES = {
  dailyStatus: "Daily Status",
  handoff: "Agent Handoffs",
  designReview: "Design Review",
} as const;

/** All repo labels boule bootstraps. */
export function allBootstrapLabels(): string[] {
  const kinds: ArtifactKind[] = Object.keys(ISSUE_TYPE_NAMES) as ArtifactKind[];
  return [
    ...kinds.map(kindLabel),
    ...Object.values(OPERATIONAL_LABELS),
    ...STATUS_LABELS,
    ...PRIORITY_LABELS,
  ];
}
