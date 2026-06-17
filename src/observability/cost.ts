// src/observability/cost.ts — reads SDK result cost/usage. Estimate-only; never gate on it.
// Logic now lives in @kleroterion/koine; this is a re-export shim so Boule keeps importing from
// "../observability/cost.js".
export { CostMeter, type ModelUsage, type ModelTotals } from "@kleroterion/koine";
