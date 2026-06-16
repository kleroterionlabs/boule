import { http, HttpResponse } from "msw";
import pino from "pino";
import { describe, expect, it } from "vitest";
import type { AuthConfig } from "../../src/config/auth.js";
import { createGitHubClient } from "../../src/github/client.js";
import { listOpenQuestionArtifacts, upsertIssue } from "../../src/github/issues.js";
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
