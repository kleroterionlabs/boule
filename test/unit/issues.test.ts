import { http, HttpResponse } from "msw";
import pino from "pino";
import { describe, expect, it } from "vitest";
import type { AuthConfig } from "../../src/config/auth.js";
import { createGitHubClient } from "../../src/github/client.js";
import { upsertIssue } from "../../src/github/issues.js";
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
