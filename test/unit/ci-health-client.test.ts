import { Octokit } from "@octokit/rest";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { type ActionsClient, createActionsClient } from "../../src/ci-health/client.js";
import { CiHealthFetchError } from "../../src/ci-health/types.js";
import { server } from "../setup.js";

const ORG_REPOS = "https://api.github.com/orgs/acme/repos";
const WORKFLOW_RUNS = "https://api.github.com/repos/acme/widgets/actions/runs";

/** A fresh Octokit pointed at the MSW-intercepted public GitHub API. */
function octokit(): Octokit {
  return new Octokit({ auth: "ghp_test" });
}

/** Build a minimal `listForOrg` payload entry. */
function repo(name: string, over: { archived?: boolean; disabled?: boolean } = {}): Record<string, unknown> {
  return {
    name,
    full_name: `acme/${name}`,
    owner: { login: "acme" },
    archived: over.archived ?? false,
    disabled: over.disabled ?? false,
  };
}

describe("createActionsClient", () => {
  it("returns an object with listRunsForRepo and listOrgRepos methods", () => {
    const client: ActionsClient = createActionsClient(octokit());
    expect(typeof client.listOrgRepos).toBe("function");
    expect(typeof client.listRunsForRepo).toBe("function");
  });

  it("returns all 150 RepoRefs across two pages via the Link header", async () => {
    // 100 repos on page 1 + 50 on page 2; `paginate` must follow the `Link: rel=next` header.
    const page1 = Array.from({ length: 100 }, (_, i) => repo(`r${i}`));
    const page2 = Array.from({ length: 50 }, (_, i) => repo(`r${100 + i}`));

    server.use(
      http.get(ORG_REPOS, ({ request }) => {
        const page = new URL(request.url).searchParams.get("page") ?? "1";
        if (page === "1") {
          return HttpResponse.json(page1, {
            headers: { Link: `<${ORG_REPOS}?per_page=100&page=2>; rel="next"` },
          });
        }
        return HttpResponse.json(page2);
      }),
    );

    const repos = await createActionsClient(octokit()).listOrgRepos("acme");
    expect(repos).toHaveLength(150);
    expect(repos[0]).toEqual({ owner: "acme", name: "r0", fullName: "acme/r0" });
    expect(repos[149]).toEqual({ owner: "acme", name: "r149", fullName: "acme/r149" });
  });

  it("excludes archived and disabled repos from the result", async () => {
    server.use(
      http.get(ORG_REPOS, () =>
        HttpResponse.json([
          repo("active"),
          repo("stale", { archived: true }),
          repo("frozen", { disabled: true }),
        ]),
      ),
    );

    const repos = await createActionsClient(octokit()).listOrgRepos("acme");
    expect(repos.map((r) => r.name)).toEqual(["active"]);
  });

  it("throws a typed CiHealthFetchError carrying the originating HTTP status", async () => {
    server.use(http.get(ORG_REPOS, () => HttpResponse.json({ message: "boom" }, { status: 503 })));

    const client = createActionsClient(octokit());
    await expect(client.listOrgRepos("acme")).rejects.toBeInstanceOf(CiHealthFetchError);
    await expect(client.listOrgRepos("acme")).rejects.toMatchObject({
      name: "CiHealthFetchError",
      status: 503,
    });
  });

  it("maps workflow runs and converts timestamps to Date objects", async () => {
    server.use(
      http.get(WORKFLOW_RUNS, () =>
        HttpResponse.json({
          total_count: 1,
          workflow_runs: [
            {
              id: 42,
              name: "CI",
              repository: { full_name: "acme/widgets" },
              status: "completed",
              conclusion: "success",
              head_sha: "abc123",
              head_branch: "main",
              created_at: "2024-01-01T00:00:00Z",
              updated_at: "2024-01-01T01:00:00Z",
              html_url: "https://github.com/acme/widgets/actions/runs/42",
            },
          ],
        }),
      ),
    );

    const runs = await createActionsClient(octokit()).listRunsForRepo("acme", "widgets");
    expect(runs).toHaveLength(1);
    const run = runs[0]!;
    expect(run.id).toBe(42);
    expect(run.name).toBe("CI");
    expect(run.repoFullName).toBe("acme/widgets");
    expect(run.status).toBe("completed");
    expect(run.conclusion).toBe("success");
    expect(run.headSha).toBe("abc123");
    expect(run.headBranch).toBe("main");
    expect(run.htmlUrl).toBe("https://github.com/acme/widgets/actions/runs/42");
    expect(run.createdAt).toBeInstanceOf(Date);
    expect(run.updatedAt).toBeInstanceOf(Date);
    expect(run.createdAt.toISOString()).toBe("2024-01-01T00:00:00.000Z");
  });
});
