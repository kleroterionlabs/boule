import { http, HttpResponse } from "msw";
import pino from "pino";
import { describe, expect, it } from "vitest";
import type { AuthConfig } from "../../src/config/auth.js";
import { createGitHubClient } from "../../src/github/client.js";
import { server } from "../setup.js";

const auth: AuthConfig = { claudeAuth: "subscription-login", github: { kind: "pat", token: "ghp_test" } };
const log = pino({ level: "silent" });
const GQL = "https://api.github.com/graphql";

describe("GitHubClient.graphql rateLimit injection", () => {
  it("appends rateLimit to read queries but NEVER to write mutations", async () => {
    // Regression guard: rateLimit{} exists only on the Query type, so injecting it into a
    // mutation breaks every GraphQL write ("Field 'rateLimit' doesn't exist on type 'Mutation'").
    const gh = await createGitHubClient(auth, log);
    const seen: string[] = [];
    server.use(
      http.post(GQL, async ({ request }) => {
        seen.push(((await request.json()) as { query: string }).query);
        return HttpResponse.json({ data: {} });
      }),
    );

    await gh.graphql("read", "query Q { viewer { login } }");
    await gh.graphql("write", "mutation M { createIssueType(input: {}) { issueType { id } } }");

    expect(seen).toHaveLength(2);
    expect(seen[0]).toContain("rateLimit"); // read → injected for budget tracking
    expect(seen[1]).not.toContain("rateLimit"); // write → never injected
  });
});
