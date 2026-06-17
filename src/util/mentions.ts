// src/util/mentions.ts — re-export shim. The @-mention sanitizer now lives in @kleroterion/koine
// (koine adopted Boule's drop-the-"@" behavior verbatim, so on-wire output is unchanged).
export { sanitizeMentions, type MentionResult } from "@kleroterion/koine";
