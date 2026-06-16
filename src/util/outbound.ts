// src/util/outbound.ts — the single cleanup applied to every agent-authored string before it reaches
// GitHub: redact credentials, then neutralize @-mentions (Boule artifacts never tag people).
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
