import pino from "pino";
import { describe, expect, it } from "vitest";
import type { GitHubClient } from "../../src/github/client.js";
import type { LedgerEntry } from "../../src/observability/ledger.js";
import { reverseRun } from "../../src/state/undo.js";

const log = pino({ level: "silent" });

function fakeGh(): { gh: GitHubClient; calls: { query: string; vars: Record<string, unknown> }[] } {
  const calls: { query: string; vars: Record<string, unknown> }[] = [];
  const gh = {
    graphql: async (_op: string, query: string, vars?: Record<string, unknown>) => {
      calls.push({ query, vars: vars ?? {} });
      return {};
    },
  } as unknown as GitHubClient;
  return { gh, calls };
}

const entries: LedgerEntry[] = [
  { ts: "t", action: "issue.create", bouleId: "design:a", number: 1, nodeId: "I_1", url: "u1" },
  { ts: "t", action: "project.item", bouleId: "design:a", itemId: "PVTI_1" },
  { ts: "t", action: "project.field", bouleId: "design:a", itemId: "PVTI_1" },
  { ts: "t", action: "issue.update", bouleId: "design:b", number: 2, nodeId: "I_2", url: "u2" },
  { ts: "t", action: "discussion.create", number: 9, nodeId: "D_9", url: "u9" },
];

describe("reverseRun", () => {
  it("closes created issues, deletes created discussions & board items; reports the rest", async () => {
    const { gh, calls } = fakeGh();
    const report = await reverseRun(gh, {
      owner: "acme",
      name: "widgets",
      projectId: "PVT_1",
      entries,
      runId: "RUN1",
      dryRun: false,
      log,
    });

    expect(report.closedIssues).toEqual([1]);
    expect(report.deletedDiscussions).toEqual([9]);
    expect(report.removedItems).toBe(1);
    // issue.update + project.field have no auto-reverse
    expect(report.skipped.map((s) => s.action).sort()).toEqual(["issue.update", "project.field"]);
    expect(report.errors).toHaveLength(0);

    const fired = calls.map((c) => c.query);
    expect(fired.some((q) => q.includes("closeIssue"))).toBe(true);
    expect(fired.some((q) => q.includes("deleteDiscussion"))).toBe(true);
    expect(fired.some((q) => q.includes("deleteProjectV2Item"))).toBe(true);
    expect(fired.some((q) => q.includes("addComment"))).toBe(true);
  });

  it("dry-run writes nothing but still plans the reversal", async () => {
    const { gh, calls } = fakeGh();
    const report = await reverseRun(gh, {
      owner: "acme",
      name: "widgets",
      projectId: "PVT_1",
      entries,
      runId: "RUN1",
      dryRun: true,
      log,
    });
    expect(report.closedIssues).toEqual([1]);
    expect(report.removedItems).toBe(1);
    expect(calls).toHaveLength(0); // no mutations issued under dry-run
  });

  it("skips project items when no project is configured", async () => {
    const { gh } = fakeGh();
    const report = await reverseRun(gh, {
      owner: "acme",
      name: "widgets",
      entries,
      runId: "RUN1",
      dryRun: false,
      log,
    });
    expect(report.removedItems).toBe(0);
    expect(report.skipped.some((s) => s.action === "project.item")).toBe(true);
  });
});
