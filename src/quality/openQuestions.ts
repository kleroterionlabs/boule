// src/quality/openQuestions.ts — pure parsing/transforms for an artifact's Open Questions.
// Network-free and deterministic so it's trivially testable; GitHub I/O lives in github/oqResolution.ts.

export interface OpenQuestion {
  id: string; // normalized upper-case, e.g. "OQ2"
  text: string; // the question, sans bullet/markdown/legacy owner suffix
}

export interface Resolution {
  id: string;
  answer: string;
  by?: string; // GitHub login that supplied the answer (for the audit trail)
  source: "interactive" | "explicit" | "comment";
}

const OQ_HEADING = /(^|\n)#{1,6}[ \t]*(?:\d+\.[ \t]*)?Open Questions[ \t]*\r?\n/i;
const DEC_HEADING = /(^|\n)#{1,6}[ \t]*Resolved Decisions[ \t]*\r?\n/i;
const NEXT_HEADING = /\n#{1,6}[ \t]/;
const OWNER_SUFFIX = /[ \t]*[—–-][ \t]*owner:.*$/i;
const CONTINUATION = /^[ \t]+\S/; // an indented, non-empty line continues the prior list item

/** Locate the body slice between a heading and the next heading (exclusive). */
function sectionAfter(body: string, heading: RegExp): { start: number; end: number; content: string } | null {
  const m = heading.exec(body);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = body.slice(start);
  const next = rest.search(NEXT_HEADING);
  const end = next === -1 ? body.length : start + next;
  return { start, end, content: body.slice(start, end) };
}

export function findOpenQuestionsSection(
  body: string,
): { start: number; end: number; content: string } | null {
  return sectionAfter(body, OQ_HEADING);
}

/** A list line is an OQ iff (after stripping a bullet + bold) it begins with `OQ<n>`. */
function matchOqLine(line: string): { id: string; rest: string } | null {
  const stripped = line
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/, "") // -, *, +, or ordered (1. / 1)) bullets
    .replace(/\*\*/g, "")
    .trim();
  const m = /^(OQ\d+)\b[ \t]*[:.)\]]?[ \t]*(.*)$/i.exec(stripped);
  if (!m?.[1]) return null;
  return { id: m[1].toUpperCase(), rest: (m[2] ?? "").trim() };
}

/** Parse Open Questions, folding wrapped continuation lines into the question text. */
export function parseOpenQuestions(body: string): OpenQuestion[] {
  const sec = findOpenQuestionsSection(body);
  if (!sec) return [];
  const out: OpenQuestion[] = [];
  let current: OpenQuestion | null = null;
  for (const line of sec.content.split("\n")) {
    const m = matchOqLine(line);
    if (m) {
      current = { id: m.id, text: m.rest.replace(OWNER_SUFFIX, "").trim() };
      out.push(current);
    } else if (current && CONTINUATION.test(line)) {
      current.text = `${current.text} ${line.trim()}`.trim();
    } else {
      current = null; // blank or non-indented line ends the item
    }
  }
  return out;
}

/** Ids already recorded under a "Resolved Decisions" section, e.g. from `**OQ1**`. */
export function resolvedIds(body: string): Set<string> {
  const sec = sectionAfter(body, DEC_HEADING);
  const ids = new Set<string>();
  if (!sec) return ids;
  for (const m of sec.content.matchAll(/\bOQ\d+\b/gi)) ids.add(m[0].toUpperCase());
  return ids;
}

/** The verbatim "Resolved Decisions" section (heading + content), or "" if absent. */
export function extractDecisionsSection(body: string): string {
  const m = DEC_HEADING.exec(body);
  if (!m) return "";
  const headingStart = m.index + (m[1] ? 1 : 0); // skip the newline captured in group 1
  const sec = sectionAfter(body, DEC_HEADING);
  const end = sec ? sec.end : body.length;
  return body.slice(headingStart, end).trimEnd();
}

/** Remove resolved OQ list items (and their wrapped continuation lines) from an OQ section's content. */
function dropResolved(content: string, ids: Set<string>): string {
  const kept: string[] = [];
  let skipping = false;
  for (const line of content.split("\n")) {
    const m = matchOqLine(line);
    if (m) {
      skipping = ids.has(m.id);
      if (!skipping) kept.push(line);
      continue;
    }
    if (skipping && CONTINUATION.test(line)) continue; // drop continuation of a resolved OQ
    skipping = false;
    kept.push(line);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * Move resolved questions out of "Open Questions" into "Resolved Decisions".
 * `body` MUST be the artifact body WITHOUT its boule block (the caller re-appends it to refresh the
 * content-hash). Unresolved questions and all other content are preserved verbatim.
 */
export function applyResolutions(body: string, resolutions: Resolution[], today: string): string {
  if (resolutions.length === 0) return body;
  const ids = new Set(resolutions.map((r) => r.id.toUpperCase()));
  const byId = new Map(parseOpenQuestions(body).map((q) => [q.id, q]));

  let next = body;
  const sec = findOpenQuestionsSection(body);
  if (sec) next = body.slice(0, sec.start) + dropResolved(sec.content, ids) + body.slice(sec.end);

  const block = resolutions
    .map((r) => {
      const q = byId.get(r.id.toUpperCase());
      const who = r.by ? ` by @${r.by}` : "";
      return `- **${r.id}** (resolved ${today}${who})${q ? `: ${q.text}` : ""}\n  - **Decision:** ${r.answer}`;
    })
    .join("\n");

  return insertDecisions(next, block);
}

/** Append to an existing Resolved Decisions section, else create one before Links (or at the end). */
function insertDecisions(body: string, block: string): string {
  const dh = DEC_HEADING.exec(body);
  if (dh) {
    const at = dh.index + dh[0].length;
    return `${body.slice(0, at)}\n${block}\n${body.slice(at)}`;
  }
  const section = `## Resolved Decisions\n\n${block}\n`;
  const links = /\n#{1,6}[ \t]*Links\b/i.exec(body);
  if (links) {
    return `${body.slice(0, links.index).trimEnd()}\n\n${section}${body.slice(links.index)}`;
  }
  return `${body.trimEnd()}\n\n${section}`;
}

/**
 * Merge a freshly regenerated body with an existing body's human resolutions: drop already-resolved
 * Open Questions and carry the existing "Resolved Decisions" section forward. Keeps `boule resolve`
 * edits durable across agent re-runs (which regenerate the body from the brief and would otherwise
 * re-open answered questions / delete decisions). Both inputs are bodies WITHOUT the boule block.
 */
export function preserveResolutions(regenerated: string, existing: string): string {
  const ids = resolvedIds(existing);
  const decisions = extractDecisionsSection(existing);
  if (ids.size === 0 && !decisions) return regenerated;

  let out = regenerated;
  const sec = findOpenQuestionsSection(out);
  if (sec) out = out.slice(0, sec.start) + dropResolved(sec.content, ids) + out.slice(sec.end);

  if (decisions && !DEC_HEADING.test(out)) {
    const links = /\n#{1,6}[ \t]*Links\b/i.exec(out);
    out = links
      ? `${out.slice(0, links.index).trimEnd()}\n\n${decisions}\n${out.slice(links.index)}`
      : `${out.trimEnd()}\n\n${decisions}\n`;
  }
  return out;
}

/** Extract `OQ<n>: <answer>` style answers from a free-text comment body. */
export function extractAnswersFromText(
  text: string,
  by: string,
): Array<{ id: string; answer: string; by: string }> {
  const out: Array<{ id: string; answer: string; by: string }> = [];
  // Accept "OQ2: answer", "OQ2 - answer", "OQ2 — answer", "**OQ2**: answer" — one per line.
  const re = /(?:^|\n)[ \t]*(?:[-*+][ \t]+)?\*{0,2}(OQ\d+)\*{0,2}[ \t]*[:.)\-—–][ \t]*(.+?)[ \t]*(?=\n|$)/gi;
  let m: RegExpExecArray | null = re.exec(text);
  while (m !== null) {
    const id = m[1];
    const answer = (m[2] ?? "").trim();
    if (id && answer) out.push({ id: id.toUpperCase(), answer, by });
    m = re.exec(text);
  }
  return out;
}
