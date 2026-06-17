// src/core/taxonomy.ts — never hardcode taxonomy strings elsewhere; import from here.
// Single-sourced from @kleroterion/koine; this re-export shim preserves the "../core/taxonomy.js"
// import path used across Boule, with no change to any on-wire label/Issue-Type/board string.
export {
  ISSUE_TYPE_NAMES,
  kindLabel,
  OPERATIONAL_LABELS,
  STATUS_LABELS,
  type StatusLabel,
  PRIORITY_LABELS,
  PROJECT_FIELDS,
  STATUS_OPTIONS,
  DISCUSSION_CATEGORIES,
  allBootstrapLabels,
} from "@kleroterion/koine";
