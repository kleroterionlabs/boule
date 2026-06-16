import { describe, expect, it } from "vitest";
import type { GitHubClient } from "../../src/github/client.js";
import { canReconcile, gatherCommentAnswers, persistResolutions } from "../../src/github/oqResolution.js";
import { parseBouleBlock } from "../../src/util/idempotency.js";

const BODY = `## 8. Open Questions

- OQ1: aggregate org-wide?
- OQ2: flaky threshold?

### Links

<!-- boule:v1
kind: design
boule-id: design:x
content-hash: sha256:deadbeefdeadbeef
parent:
run-id: R1
generated-by: boule
-->
`;

describe("canReconcile", () => {
  it("allows admin/write/maintain only", () => {
    expect(canReconcile("admin")).toBe(true);
    expect(canReconcile("write")).toBe(true);
    expect(canReconcile("maintain")).toBe(true);
    expect(canReconcile("read")).toBe(false);
    expect(canReconcile("none")).toBe(false);
  });
});

// Minimal fake of the REST surface the resolution code touches.
function fakeGh(opts: {
  comments?: Array<{ login: string; body: string }>;
  perms?: Record<string, string>;
}): { gh: GitHubClient; updates: Array<{ body: string }>; comments: string[] } {
  const updates: Array<{ body: string }> = [];
  const postedComments: string[] = [];
  const rest = {
    issues: {
      listComments: async () => ({
        data: (opts.comments ?? []).map((c) => ({ user: { login: c.login }, body: c.body })),
      }),
      update: async (p: { body: string }) => {
        updates.push({ body: p.body });
        return { data: {} };
      },
      createComment: async (p: { body: string }) => {
        postedComments.push(p.body);
        return { data: {} };
      },
    },
    repos: {
      getCollaboratorPermissionLevel: async (p: { username: string }) => ({
        data: { permission: opts.perms?.[p.username] ?? "none" },
      }),
    },
  };
  const gh = {
    withRest: async (_op: string, fn: (o: unknown) => unknown) => fn(rest),
  } as unknown as GitHubClient;
  return { gh, updates, comments: postedComments };
}

describe("gatherCommentAnswers", () => {
  it("tags each answer with the author's authorization", async () => {
    const { gh } = fakeGh({
      comments: [
        { login: "alice", body: "OQ1: org-wide" },
        { login: "mallory", body: "OQ2: my hostile answer" },
      ],
      perms: { alice: "write", mallory: "read" },
    });
    const answers = await gatherCommentAnswers(gh, "acme", "widgets", 1);
    const alice = answers.find((a) => a.by === "alice");
    const mallory = answers.find((a) => a.by === "mallory");
    expect(alice?.authorized).toBe(true);
    expect(mallory?.authorized).toBe(false);
    expect(mallory?.permission).toBe("read");
  });
});

describe("persistResolutions", () => {
  it("edits the body, refreshes the content-hash, and posts an audit comment", async () => {
    const { gh, updates, comments } = fakeGh({});
    const res = await persistResolutions(gh, {
      owner: "acme",
      name: "widgets",
      number: 1,
      url: "u1",
      body: BODY,
      resolutions: [{ id: "OQ1", answer: "Org-wide.", by: "alice", source: "comment" }],
      today: "2026-06-15",
      dryRun: false,
    });
    expect(res.applied).toHaveLength(1);
    expect(updates).toHaveLength(1);
    const newBody = updates[0]?.body ?? "";
    expect(newBody).toContain("## Resolved Decisions");
    expect(newBody).toContain("Org-wide.");
    expect(newBody).not.toMatch(/- OQ1: aggregate/);
    // boule block preserved with a fresh (different) content-hash
    const block = parseBouleBlock(newBody);
    expect(block?.bouleId).toBe("design:x");
    expect(block?.contentHash).not.toBe("sha256:deadbeefdeadbeef");
    expect(comments[0]).toContain("OQ1");
  });

  it("neutralizes @-mentions in the answer it writes into the body and audit comment", async () => {
    const { gh, updates, comments } = fakeGh({});
    await persistResolutions(gh, {
      owner: "acme",
      name: "widgets",
      number: 1,
      url: "u1",
      body: BODY,
      resolutions: [
        { id: "OQ1", answer: "ping @platform-lead and @everyone", by: "alice", source: "comment" },
      ],
      today: "2026-06-15",
      dryRun: false,
    });
    const newBody = updates[0]?.body ?? "";
    expect(newBody).toContain("ping platform-lead and everyone");
    expect(newBody).not.toContain("@platform-lead");
    expect(newBody).not.toContain("@everyone");
    expect(comments[0]).not.toContain("@platform-lead");
  });

  it("writes nothing under dry-run", async () => {
    const { gh, updates, comments } = fakeGh({});
    await persistResolutions(gh, {
      owner: "acme",
      name: "widgets",
      number: 1,
      url: "u1",
      body: BODY,
      resolutions: [{ id: "OQ1", answer: "x", source: "explicit" }],
      today: "2026-06-15",
      dryRun: true,
    });
    expect(updates).toHaveLength(0);
    expect(comments).toHaveLength(0);
  });
});
