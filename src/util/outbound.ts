// src/util/outbound.ts — the single cleanup applied to every agent-authored string before it reaches
// GitHub: redact credentials, then neutralize @-mentions (Boule artifacts never tag people).
//
// NOTE: kept as Boule's OWN implementation (not a koine re-export) because it composes Boule's
// sanitizeMentions, whose neutralization differs from koine's (see util/mentions.ts). Re-exporting
// koine's cleanOutbound would change on-wire bodies. scrubSecrets IS sourced from koine (identical).
import { sanitizeMentions } from "./mentions.js";
import { scrubSecrets } from "./secrets.js";

export interface Outbound {
  clean: string;
  secrets: string[]; // kinds of credential redacted
  mentions: string[]; // handles neutralized
}

export function cleanOutbound(text: string): Outbound {
  const s = scrubSecrets(text);
  const m = sanitizeMentions(s.clean);
  return { clean: m.clean, secrets: s.found, mentions: m.stripped };
}
