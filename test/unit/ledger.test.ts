import { describe, expect, it } from "vitest";
import { Ledger, emptyMetrics } from "../../src/observability/ledger.js";

describe("Ledger", () => {
  it("counts mutations by action", () => {
    const l = new Ledger();
    l.record({ action: "issue.create", bouleId: "design:a", number: 1, nodeId: "n1", url: "u1" });
    l.record({ action: "issue.update", bouleId: "design:b", number: 2, nodeId: "n2", url: "u2" });
    l.record({ action: "issue.noop", bouleId: "design:c", number: 3 });
    l.record({ action: "subissue.link", number: 2 });
    l.record({ action: "discussion.create", number: 9, url: "d9" });
    l.record({ action: "issue.close", bouleId: "design:d", number: 4 });
    l.record({ action: "project.item.remove", itemId: "PI_1" });

    const m = l.metrics();
    expect(m.issuesCreated).toBe(1);
    expect(m.issuesUpdated).toBe(1);
    expect(m.issuesNoop).toBe(1);
    expect(m.issuesClosed).toBe(1);
    expect(m.subIssuesLinked).toBe(1);
    expect(m.projectItemsRemoved).toBe(1);
    expect(m.discussionsPosted).toBe(1);
  });

  it("writtenRefs returns only created/updated issues with a number", () => {
    const l = new Ledger();
    l.record({ action: "issue.create", number: 1, nodeId: "n1", url: "u1" });
    l.record({ action: "issue.noop", number: 2, nodeId: "n2", url: "u2" });
    l.record({ action: "discussion.create", number: 3, url: "u3" });

    const refs = l.writtenRefs();
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({ number: 1, nodeId: "n1", url: "u1" });
  });

  it("stamps each entry with an ISO timestamp", () => {
    const l = new Ledger();
    l.record({ action: "issue.create", number: 1 });
    expect(l.entries[0]?.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("emptyMetrics is all zeros", () => {
    expect(Object.values(emptyMetrics()).every((v) => v === 0)).toBe(true);
  });
});
