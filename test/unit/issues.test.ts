import { http, HttpResponse } from "msw";
import pino from "pino";
import { describe, expect, it } from "vitest";
import type { AuthConfig } from "../../src/config/auth.js";
import { createGitHubClient } from "../../src/github/client.js";
import {
  addBlockedBy,
  closeIssue,
  listIssues,
  listOpenQuestionArtifacts,
  setIssueStatus,
  upsertIssue,
} from "../../src/github/issues.js";
import { idLabel, withBouleBlock } from "../../src/util/idempotency.js";
import { server } from "../setup.js";

const auth: AuthConfig = { claudeAuth: "subscription-login", github: { kind: "pat", token: "ghp_test" } };
const log = pino({ level: "silent" });
const ISSUES = "https://api.github.com/repos/acme/widgets/issues";

const spec = (over: Partial<Parameters<typeof upsertIssue>[1]> = {}) =>
  ({
    owner: "acme",
    name: "widgets",
    kind: "design" as const,
    bouleId: "design:foo",
    title: "Foo",
    body: "Hello design",
    runId: "run1",
    dryRun: false,
    ...over,
  }) satisfies Parameters<typeof upsertIssue>[1];

describe("idLabel", () => {
  it("is deterministic, namespaced, and within GitHub's 50-char limit", () => {
    expect(idLabel("design:foo")).toBe(idLabel("design:foo"));
    expect(idLabel("design:foo")).not.toBe(idLabel("design:bar"));
    expect(idLabel("design:foo").startsWith("boule-id-")).toBe(true);
    expect(idLabel("design:foo").length).toBeLessThanOrEqual(50);
  });
});

describe("upsertIssue (label-based dedup)", () => {
  it("creates when no issue carries the dedup label", async () => {
    const gh = await createGitHubClient(auth, log);
    server.use(
      http.get(ISSUES, () => HttpResponse.json([])),
      http.post(ISSUES, async ({ request }) => {
        const b = (await request.json()) as { body: string; labels: string[] };
        expect(b.labels).toContain(idLabel("design:foo")); // dedup label is applied at create
        return HttpResponse.json(
          { number: 1, node_id: "I_1", html_url: "https://github.com/acme/widgets/issues/1", body: b.body },
          { status: 201 },
        );
      }),
    );
    const res = await upsertIssue(gh, spec());
    expect(res.action).toBe("create");
    expect(res.ref.number).toBe(1);
  });

  it("no-ops when an issue with identical content already exists", async () => {
    const gh = await createGitHubClient(auth, log);
    const body = withBouleBlock("Hello design", {
      kind: "design",
      bouleId: "design:foo",
      runId: "old",
      generatedBy: "boule",
    });
    server.use(
      http.get(ISSUES, () =>
        HttpResponse.json([
          { number: 5, node_id: "I_5", html_url: "https://github.com/acme/widgets/issues/5", body },
        ]),
      ),
    );
    const res = await upsertIssue(gh, spec());
    expect(res.action).toBe("noop");
    expect(res.ref.number).toBe(5);
  });

  it("plans but writes nothing under dry-run", async () => {
    const gh = await createGitHubClient(auth, log);
    server.use(http.get(ISSUES, () => HttpResponse.json([]))); // no POST handler ⇒ a write would error
    const res = await upsertIssue(gh, spec({ dryRun: true }));
    expect(res.action).toBe("create");
    expect(res.ref.url).toBe("(dry-run)");
  });
});

describe("closeIssue", () => {
  it("PATCHes the issue closed with the given state_reason", async () => {
    let body: { state?: string; state_reason?: string } | null = null;
    server.use(
      http.patch(`${ISSUES}/42`, async ({ request }) => {
        body = (await request.json()) as { state?: string; state_reason?: string };
        return HttpResponse.json({ number: 42, state: "closed" });
      }),
    );
    const gh = await createGitHubClient(auth, log);
    await closeIssue(gh, "acme", "widgets", 42, "not_planned");
    expect(body).toEqual({ state: "closed", state_reason: "not_planned" });
  });
});

describe("setIssueStatus", () => {
  it("swaps the existing status:* label for the target, keeping other labels", async () => {
    let sent: string[] | null = null;
    server.use(
      http.get(`${ISSUES}/1/labels`, () =>
        HttpResponse.json([
          { name: "kind:design" },
          { name: "boule:managed" },
          { name: "status:needs-review" },
        ]),
      ),
      http.put(`${ISSUES}/1/labels`, async ({ request }) => {
        sent = ((await request.json()) as { labels: string[] }).labels;
        return HttpResponse.json([]);
      }),
    );
    const gh = await createGitHubClient(auth, log);
    await setIssueStatus(gh, "acme", "widgets", 1, "status:accepted");
    expect(sent).toEqual(["kind:design", "boule:managed", "status:accepted"]); // needs-review dropped
  });
});

describe("addBlockedBy", () => {
  it("POSTs the dependency when not already present", async () => {
    let posted: { issue_id?: number } | null = null;
    server.use(
      http.get(`${ISSUES}/7/dependencies/blocked_by`, () => HttpResponse.json([])),
      http.post(`${ISSUES}/7/dependencies/blocked_by`, async ({ request }) => {
        posted = (await request.json()) as { issue_id?: number };
        return HttpResponse.json({ id: 999 });
      }),
    );
    const gh = await createGitHubClient(auth, log);
    const added = await addBlockedBy(gh, "acme", "widgets", 7, 6001);
    expect(added).toBe(true);
    expect(posted).toEqual({ issue_id: 6001 });
  });

  it("is a no-op when the dependency already exists", async () => {
    let postCalled = false;
    server.use(
      http.get(`${ISSUES}/7/dependencies/blocked_by`, () => HttpResponse.json([{ id: 6001 }])),
      http.post(`${ISSUES}/7/dependencies/blocked_by`, () => {
        postCalled = true;
        return HttpResponse.json({});
      }),
    );
    const gh = await createGitHubClient(auth, log);
    const added = await addBlockedBy(gh, "acme", "widgets", 7, 6001);
    expect(added).toBe(false);
    expect(postCalled).toBe(false);
  });
});

describe("listIssues", () => {
  const issue = (over: Record<string, unknown>) => ({
    number: 1,
    node_id: "I_1",
    html_url: "https://github.com/acme/widgets/issues/1",
    title: "Issue",
    state: "open",
    labels: [],
    body: "",
    updated_at: "2026-06-16T00:00:00Z",
    ...over,
  });

  it("summarizes issues, skips PRs, counts open questions, derives kind/boule-id", async () => {
    const body = withBouleBlock("A design\n\n## Open Questions\n- OQ1: scope?\n- OQ2: when?\n", {
      kind: "design",
      bouleId: "design:foo",
      generatedBy: "boule",
    });
    // No boule block ⇒ kind/boule-id fall back to labels; OQs all moved to Resolved Decisions.
    const resolved = "A design\n\n## Open Questions\n\n## Resolved Decisions\n- **OQ1**: yes\n";
    server.use(
      http.get(ISSUES, () =>
        HttpResponse.json([
          issue({ number: 1, body, labels: [{ name: "boule:managed" }], title: "Two OQs" }),
          issue({ number: 2, body: resolved, labels: [{ name: "kind:task" }], title: "All resolved" }),
          issue({ number: 3, pull_request: { url: "x" }, title: "A PR" }),
        ]),
      ),
    );
    const gh = await createGitHubClient(auth, log);
    const { issues, truncated } = await listIssues(gh, "acme", "widgets");
    expect(truncated).toBe(false);
    expect(issues.map((i) => i.number)).toEqual([1, 2]); // PR excluded
    expect(issues[0]).toMatchObject({
      kind: "design",
      bouleId: "design:foo",
      managed: true,
      openQuestions: 2,
    });
    expect(issues[1]).toMatchObject({ kind: "task", bouleId: null, managed: false, openQuestions: 0 });
  });

  it("caps at max and reports truncation", async () => {
    server.use(
      http.get(ISSUES, () => HttpResponse.json([1, 2, 3].map((n) => issue({ number: n, title: `#${n}` })))),
    );
    const gh = await createGitHubClient(auth, log);
    const { issues, truncated } = await listIssues(gh, "acme", "widgets", { max: 2 });
    expect(issues).toHaveLength(2);
    expect(truncated).toBe(true);
  });

  it("forwards state/labels/since as query params", async () => {
    const query: Record<string, string | null> = {};
    server.use(
      http.get(ISSUES, ({ request }) => {
        const p = new URL(request.url).searchParams;
        query.state = p.get("state");
        query.labels = p.get("labels");
        query.since = p.get("since");
        return HttpResponse.json([]);
      }),
    );
    const gh = await createGitHubClient(auth, log);
    await listIssues(gh, "acme", "widgets", {
      state: "all",
      labels: ["boule:managed", "kind:task"],
      since: "2026-01-01T00:00:00Z",
    });
    expect(query).toEqual({
      state: "all",
      labels: "boule:managed,kind:task",
      since: "2026-01-01T00:00:00Z",
    });
  });
});

describe("listOpenQuestionArtifacts", () => {
  const issue = (over: Record<string, unknown>) => ({
    number: 1,
    node_id: "I_1",
    html_url: "https://github.com/acme/widgets/issues/1",
    title: "Issue",
    body: "",
    ...over,
  });
  const withOQ = (...qs: string[]) =>
    withBouleBlock(`## Open Questions\n${qs.map((q, i) => `- OQ${i + 1}: ${q}`).join("\n")}\n`, {
      kind: "design",
      bouleId: "design:foo",
      generatedBy: "boule",
    });

  it("returns only managed issues that still have open questions, sorted by number", async () => {
    server.use(
      http.get(ISSUES, () =>
        HttpResponse.json([
          issue({ number: 7, body: withOQ("scope?", "owner?"), title: "Has two" }),
          issue({ number: 3, body: withOQ("just one?"), title: "Has one" }),
          issue({ number: 4, body: "## Open Questions\n\nNone yet.\n", title: "No OQ lines" }),
          issue({ number: 5, body: withOQ("pr?"), pull_request: { url: "x" }, title: "A PR" }),
        ]),
      ),
    );
    const gh = await createGitHubClient(auth, log);
    const found = await listOpenQuestionArtifacts(gh, "acme", "widgets");
    expect(found.map((f) => f.number)).toEqual([3, 7]); // #4 has no OQ lines, #5 is a PR
    expect(found[0]).toMatchObject({ number: 3, openCount: 1, bouleId: "design:foo" });
    expect(found[1]?.openCount).toBe(2);
  });

  it("queries with the managed label and open state", async () => {
    const query: Record<string, string | null> = {};
    server.use(
      http.get(ISSUES, ({ request }) => {
        const p = new URL(request.url).searchParams;
        query.labels = p.get("labels");
        query.state = p.get("state");
        return HttpResponse.json([]);
      }),
    );
    const gh = await createGitHubClient(auth, log);
    expect(await listOpenQuestionArtifacts(gh, "acme", "widgets")).toEqual([]);
    expect(query).toEqual({ labels: "boule:managed", state: "open" });
  });
});
