import { http, HttpResponse } from "msw";
import pino from "pino";
import { describe, expect, it } from "vitest";
import type { AuthConfig } from "../../src/config/auth.js";
import { createGitHubClient } from "../../src/github/client.js";
import { discussionMarker, upsertDiscussion } from "../../src/github/discussions.js";
import { server } from "../setup.js";

const auth: AuthConfig = { claudeAuth: "subscription-login", github: { kind: "pat", token: "ghp_test" } };
const log = pino({ level: "silent" });
const GQL = "https://api.github.com/graphql";

const spec = (over: Partial<Parameters<typeof upsertDiscussion>[1]> = {}) =>
  ({
    owner: "acme",
    name: "widgets",
    repoId: "R_1",
    categoryId: "DIC_1",
    key: "status:2026-06-15",
    title: "Daily Status — 2026-06-15",
    body: "All green.",
    dryRun: false,
    ...over,
  }) satisfies Parameters<typeof upsertDiscussion>[1];

describe("upsertDiscussion (marker-based idempotency)", () => {
  it("creates when no discussion carries the key marker", async () => {
    const gh = await createGitHubClient(auth, log);
    server.use(
      http.post(GQL, async ({ request }) => {
        const { query, variables } = (await request.json()) as {
          query: string;
          variables: Record<string, unknown>;
        };
        if (query.includes("discussions(")) {
          return HttpResponse.json({ data: { repository: { discussions: { nodes: [] } } } });
        }
        // create — the body must carry the embedded marker so a later run can re-find it
        expect(String(variables.body)).toContain(discussionMarker("status:2026-06-15"));
        return HttpResponse.json({
          data: { createDiscussion: { discussion: { number: 7, nodeId: "D_7", url: "u7" } } },
        });
      }),
    );
    const res = await upsertDiscussion(gh, spec());
    expect(res.action).toBe("create");
    expect(res.ref.number).toBe(7);
  });

  it("updates the existing post in place when the marker is found", async () => {
    const gh = await createGitHubClient(auth, log);
    let updatedId: unknown;
    server.use(
      http.post(GQL, async ({ request }) => {
        const { query, variables } = (await request.json()) as {
          query: string;
          variables: Record<string, unknown>;
        };
        if (query.includes("discussions(")) {
          return HttpResponse.json({
            data: {
              repository: {
                discussions: {
                  nodes: [
                    {
                      number: 3,
                      nodeId: "D_3",
                      url: "u3",
                      body: `yesterday\n\n${discussionMarker("status:2026-06-15")}`,
                    },
                  ],
                },
              },
            },
          });
        }
        if (query.includes("updateDiscussion")) {
          updatedId = variables.discussionId;
          return HttpResponse.json({
            data: { updateDiscussion: { discussion: { number: 3, nodeId: "D_3", url: "u3" } } },
          });
        }
        throw new Error("should not create when an existing post matches the marker");
      }),
    );
    const res = await upsertDiscussion(gh, spec());
    expect(res.action).toBe("update");
    expect(res.ref.number).toBe(3);
    expect(updatedId).toBe("D_3");
  });

  it("plans but writes nothing under dry-run", async () => {
    const gh = await createGitHubClient(auth, log);
    server.use(http.post(GQL, () => HttpResponse.json({ data: {} }))); // a real op would fail to parse
    const res = await upsertDiscussion(gh, spec({ dryRun: true }));
    expect(res.action).toBe("create");
    expect(res.ref.url).toBe("(dry-run)");
  });
});
