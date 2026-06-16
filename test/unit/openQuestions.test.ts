import { describe, expect, it } from "vitest";
import {
  applyResolutions,
  extractAnswersFromText,
  parseOpenQuestions,
  preserveResolutions,
  resolvedIds,
} from "../../src/quality/openQuestions.js";

const BODY = `## 7. Risks

| ID | Risk |

## 8. Open Questions

- **OQ1:** Should the dashboard aggregate across the org or require a repo list? — owner: @platform-lead
- **OQ2:** What threshold flags a test as flaky? — owner: @tech-lead
- OQ3: Persist metrics beyond 90 days?

### Links
Generates-requirements:
`;

describe("parseOpenQuestions", () => {
  it("extracts ids and text, stripping bold and legacy owner suffixes", () => {
    const qs = parseOpenQuestions(BODY);
    expect(qs.map((q) => q.id)).toEqual(["OQ1", "OQ2", "OQ3"]);
    expect(qs[0]?.text).toBe("Should the dashboard aggregate across the org or require a repo list?");
    expect(qs[0]?.text).not.toContain("owner");
    expect(qs[2]?.text).toBe("Persist metrics beyond 90 days?");
  });

  it("returns [] when there is no Open Questions section", () => {
    expect(parseOpenQuestions("## Problem\nx")).toEqual([]);
  });
});

describe("applyResolutions", () => {
  it("moves resolved questions to a Decisions section and keeps the rest", () => {
    const out = applyResolutions(
      BODY,
      [
        { id: "OQ1", answer: "Org-wide by default; --repos to narrow.", by: "alice", source: "comment" },
        { id: "OQ3", answer: "No — accept the 90-day cap for v1.", source: "explicit" },
      ],
      "2026-06-15",
    );
    // resolved removed from Open Questions
    expect(out).not.toMatch(/OQ1:\*?\*? Should the dashboard/);
    expect(out).not.toMatch(/- OQ3: Persist/);
    // unresolved kept
    expect(out).toMatch(/OQ2:\*?\*? What threshold/);
    // decisions recorded with author + answer, placed before Links
    expect(out).toContain("## Resolved Decisions");
    expect(out).toContain("**OQ1** (resolved 2026-06-15 by @alice)");
    expect(out).toContain("Org-wide by default");
    expect(out).toContain("No — accept the 90-day cap");
    expect(out.indexOf("## Resolved Decisions")).toBeLessThan(out.indexOf("### Links"));
  });

  it("is a no-op with no resolutions", () => {
    expect(applyResolutions(BODY, [], "2026-06-15")).toBe(BODY);
  });

  it("appends to an existing Decisions section instead of duplicating it", () => {
    const withDecisions = `${BODY}\n## Resolved Decisions\n\n- **OQ9** (resolved 2026-01-01): old\n`;
    const out = applyResolutions(
      withDecisions,
      [{ id: "OQ2", answer: "3 failures in 24h.", source: "explicit" }],
      "2026-06-15",
    );
    expect(out.match(/## Resolved Decisions/g)).toHaveLength(1);
    expect(out).toContain("old");
    expect(out).toContain("3 failures in 24h.");
  });
});

describe("extractAnswersFromText", () => {
  it("pulls OQ answers from a comment, ignoring prose", () => {
    const out = extractAnswersFromText(
      "I think:\nOQ2: 3 failures + 1 pass in 24h\n- **OQ3** - keep it simple, no persistence\nthanks",
      "bob",
    );
    expect(out).toEqual([
      { id: "OQ2", answer: "3 failures + 1 pass in 24h", by: "bob" },
      { id: "OQ3", answer: "keep it simple, no persistence", by: "bob" },
    ]);
  });

  it("accepts em-dash and en-dash separators (smart-substitution friendly)", () => {
    expect(extractAnswersFromText("OQ2 — three failures", "bob")).toEqual([
      { id: "OQ2", answer: "three failures", by: "bob" },
    ]);
    expect(extractAnswersFromText("OQ2 – three failures", "bob")[0]?.answer).toBe("three failures");
  });

  it("returns [] when there are no OQ references", () => {
    expect(extractAnswersFromText("just a normal comment", "bob")).toEqual([]);
  });
});

describe("parser robustness", () => {
  it("folds wrapped continuation lines into the question text", () => {
    const body =
      "## Open Questions\n\n- OQ1: Should we aggregate org-wide,\n  or take an explicit repo list?\n- OQ2: flaky threshold?\n";
    const qs = parseOpenQuestions(body);
    expect(qs[0]?.text).toBe("Should we aggregate org-wide, or take an explicit repo list?");
    expect(qs).toHaveLength(2);
  });

  it("recognizes ordered-list and '+' bullets", () => {
    const body = "## Open Questions\n\n1. OQ1: a?\n+ OQ2: b?\n";
    expect(parseOpenQuestions(body).map((q) => q.id)).toEqual(["OQ1", "OQ2"]);
  });

  it("drops a resolved question's orphan continuation line but keeps the full text in the Decision", () => {
    const body = "## Open Questions\n\n- OQ1: long one\n  wrapped tail?\n- OQ2: keep me?\n\n### Links\n";
    const out = applyResolutions(body, [{ id: "OQ1", answer: "done", source: "explicit" }], "2026-06-15");
    const [openQuestions, decisions] = out.split("## Resolved Decisions");
    expect(openQuestions).not.toContain("wrapped tail?"); // no stranded orphan line
    expect(openQuestions).toContain("OQ2: keep me?");
    expect(decisions).toContain("long one wrapped tail?"); // folded into the recorded question
  });
});

describe("preserveResolutions (convergence across agent re-runs)", () => {
  const original =
    "## 8. Open Questions\n\n- OQ1: aggregate org-wide?\n- OQ2: flaky threshold?\n\n### Links\nGenerates-requirements:\n";

  it("a re-run merges to exactly the resolved body (so the content-hash converges to a no-op)", () => {
    const resolved = applyResolutions(
      original,
      [{ id: "OQ1", answer: "Org-wide.", by: "alice", source: "comment" }],
      "2026-06-15",
    );
    // The agent regenerates `original` from the brief; merging must reproduce `resolved` byte-for-byte.
    expect(preserveResolutions(original, resolved)).toBe(resolved);
  });

  it("re-opened questions are stripped and decisions carried even if the agent rewrote them", () => {
    const resolved = applyResolutions(
      original,
      [{ id: "OQ1", answer: "Org-wide.", source: "explicit" }],
      "2026-06-15",
    );
    const merged = preserveResolutions(original, resolved);
    expect(resolvedIds(merged).has("OQ1")).toBe(true);
    expect(merged).toContain("## Resolved Decisions");
    expect(merged).not.toMatch(/- OQ1: aggregate/);
    expect(merged).toContain("OQ2: flaky threshold?");
  });

  it("is a no-op when the existing body has no resolutions", () => {
    expect(preserveResolutions(original, original)).toBe(original);
  });
});
