// src/util/mentions.ts — Boule artifacts must never @-mention people. Agents have invented role
// handles (@platform-lead, @tech-lead) that ghost-tag non-existent users; this neutralizes any
// GitHub-mention-shaped token in agent-authored text by dropping the leading "@" (the word survives
// as plain text). Real human @-mentions belong in human-authored comments, not generated bodies.
//
// NOTE: kept as Boule's OWN implementation (not a koine re-export). koine's sanitizeMentions
// neutralizes mentions by backtick-quoting them (`@handle`); Boule drops the "@" entirely. Re-exporting
// koine here would change on-wire issue/discussion bodies, which this migration must not do.

// A mention is "@name" or "@org/team": starts with @ at a non-identifier boundary (so emails like
// a@b.com are skipped), name is GitHub-shaped (alphanumeric + single hyphens, ≤39 chars).
const MENTION = /(^|[^A-Za-z0-9_/@.])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\/[A-Za-z0-9._-]+)?)/g;

export interface MentionScrub {
  clean: string;
  stripped: string[];
}

export function sanitizeMentions(text: string): MentionScrub {
  const stripped = new Set<string>();
  const clean = text.replace(MENTION, (_full, pre: string, handle: string) => {
    stripped.add(handle);
    return `${pre}${handle}`;
  });
  return { clean, stripped: [...stripped] };
}
