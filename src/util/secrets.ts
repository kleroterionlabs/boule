// src/util/secrets.ts — last-line defense: redact credential-looking strings before any
// agent-authored text reaches GitHub (a public issue/discussion must never leak a token),
// independent of the pino log redaction (which only protects logs, not outbound content).

const PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "github-token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { name: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: "openai-key", re: /\bsk-[A-Za-z0-9]{32,}\b/g },
];

export interface ScrubResult {
  clean: string;
  found: string[]; // distinct credential kinds redacted
}

/** Replace any credential-looking substrings with `[REDACTED:<kind>]`; report the kinds found. */
export function scrubSecrets(text: string): ScrubResult {
  let clean = text;
  const found = new Set<string>();
  for (const { name, re } of PATTERNS) {
    const replaced = clean.replace(re, () => {
      found.add(name);
      return `[REDACTED:${name}]`;
    });
    clean = replaced;
  }
  return { clean, found: [...found] };
}
