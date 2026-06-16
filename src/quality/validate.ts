// src/quality/validate.ts — deterministic methodology gates (design §3). High-precision STRUCTURAL
// checks only: `errors` block the write (the agent must fix and retry — the bounded auto-rewrite loop),
// `warnings` are logged but allowed. Kept conservative so correct content always passes.
import type { ArtifactKind } from "../core/types.js";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const heading = (label: string) => new RegExp(`(^|\\n)#{1,6}\\s*${label}`, "i");
const word = (w: string) => new RegExp(`\\b${w}`, "i");

// The canonical artifact template is enforced by heading presence (high-precision, deterministic);
// the Critic judges the QUALITY of each section. Designs/requirements require Feasibility, Observability,
// Traceability, and an Approaches-Considered debate. Evidence citations and success KPIs are NOT required.
function validateDesign(body: string): Omit<ValidationResult, "ok"> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!heading("Non[- ]?Goals").test(body)) errors.push("PRD must have a Non-Goals section");
  if (!heading("Approaches Considered").test(body))
    errors.push("design must have an 'Approaches Considered' section (2-3 distinct options + the choice)");
  if (!heading("Feasibility").test(body)) errors.push("design must have a Feasibility section");
  if (!heading("Observability").test(body)) errors.push("design must have an Observability section");
  // JTBD job story: "When … I want to … so I can/that …"
  if (!/\bWhen\b[\s\S]{0,240}?\bI want to\b[\s\S]{0,240}?\bso (I can|that)\b/i.test(body)) {
    warnings.push("no JTBD job story in 'When … I want to … so I can …' grammar");
  }
  if (/\bAs an?\b[\s\S]{0,80}?\bI want\b/i.test(body)) {
    warnings.push("role-based 'As a… I want…' framing found — designs use JTBD job stories, not Connextra");
  }
  return { errors, warnings };
}

function validateRequirement(body: string): Omit<ValidationResult, "ok"> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!word("shall").test(body))
    errors.push("requirement must be a 'shall'-form statement (ISO/IEC/IEEE 29148)");
  const hasGherkin = word("Given").test(body) && word("When").test(body) && word("Then").test(body);
  if (!hasGherkin) errors.push("requirement must include Gherkin acceptance criteria (Given/When/Then)");
  // Traceability: must point back to the design (and ideally the job story/goal it serves).
  if (!/\b(Traces-to|Derives-from)\b/i.test(body))
    errors.push("requirement must trace to its source ('Traces-to: JS#/G#' or 'Derives-from: #<design>')");
  if (!heading("Feasibility").test(body)) errors.push("requirement must have a Feasibility section");
  if (!heading("Observability").test(body)) errors.push("requirement must have an Observability section");
  return { errors, warnings };
}

function validateCompetitor(body: string): Omit<ValidationResult, "ok"> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (/\b(Five Forces|Porter)\b/i.test(body)) {
    errors.push("Five Forces / Porter belongs ONLY on the Market Overview, never on a competitor profile");
  }
  const swot = ["Strength", "Weakness", "Opportunit", "Threat"].filter((s) => word(s).test(body));
  if (swot.length < 4) warnings.push("incomplete SWOT — need Strengths, Weaknesses, Opportunities, Threats");
  return { errors, warnings };
}

function validateMarket(body: string): Omit<ValidationResult, "ok"> {
  const errors: string[] = [];
  if (!/\b(Five Forces|Porter)\b/i.test(body))
    errors.push("Market Overview must include Porter's Five Forces");
  return { errors, warnings: [] };
}

function validateGap(body: string): Omit<ValidationResult, "ok"> {
  const cols = ["Current", "Desired", "Gap", "Action"];
  const missing = cols.filter((c) => !word(c).test(body));
  const errors = missing.length ? [`gap grid missing column(s): ${missing.join(", ")}`] : [];
  return { errors, warnings: [] };
}

const VALIDATORS: Partial<Record<ArtifactKind, (body: string) => Omit<ValidationResult, "ok">>> = {
  design: validateDesign,
  requirement: validateRequirement,
  competitor: validateCompetitor,
  market: validateMarket,
  gap: validateGap,
};

/** Validate an artifact body against its methodology gate. Unknown/decomposition kinds always pass. */
export function validateArtifact(kind: ArtifactKind, body: string): ValidationResult {
  const fn = VALIDATORS[kind];
  if (!fn) return { ok: true, errors: [], warnings: [] };
  const { errors, warnings } = fn(body);
  return { ok: errors.length === 0, errors, warnings };
}
