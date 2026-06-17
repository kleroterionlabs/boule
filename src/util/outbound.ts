// src/util/outbound.ts — re-export shim. The outbound cleanup (scrub secrets + neutralize @-mentions)
// now lives in @kleroterion/koine; both halves are identical to Boule's former behavior.
export { cleanOutbound, type Outbound } from "@kleroterion/koine";
