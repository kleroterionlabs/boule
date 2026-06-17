// src/util/secrets.ts — last-line defense: redact credential-looking strings before any
// agent-authored text reaches GitHub. Logic now lives in @kleroterion/koine; this is a re-export
// shim so Boule files keep importing from "../util/secrets.js".
export { scrubSecrets, type ScrubResult } from "@kleroterion/koine";
