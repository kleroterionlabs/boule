// src/util/idempotency.ts — the crux of safe autonomy. Pure & deterministic (network-free).
// Logic (and its 100%-coverage test) now lives in @kleroterion/koine; this is a re-export shim so
// Boule files keep importing the identity block from "../util/idempotency.js".
export {
  bouleId,
  contentHash,
  idLabel,
  parseBouleBlock,
  renderBouleBlock,
  stripBouleBlock,
  withBouleBlock,
  type BouleBlock,
} from "@kleroterion/koine";
