import type { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";
import { type ActionsClient, createActionsClient } from "../../src/ci-health/client.js";

/** Build a stub Octokit exposing only the two methods the ActionsClient calls. */
function stubOctokit(
  over: {
    listForOrg?: () => Promise<{ data: unknown }>;
    listWorkflowRunsForRepo?: () => Promise<{ data: unknown }>;
  } = {},
): Octokit {
  return {
    rest: {
      repos: {
        listForOrg: over.listForOrg ?? (async () => ({ data: [] })),
      },
      actions: {
        listWorkflowRunsForRepo:
          over.listWorkflowRunsForRepo ?? (async () => ({ data: { workflow_runs: [] } })),
      },
    },
  } as unknown as Octokit;
}

describe("createActionsClient", () => {
  it("returns an object with listRunsForRepo and listOrgRepos methods", () => {
    const client: ActionsClient = createActionsClient(stubOctokit());
    expect(typeof client.listOrgRepos).toBe("function");
    expect(typeof client.listRunsForRepo).toBe("function");
  });

  it("maps org repos to the OrgRepo domain shape", async () => {
    const client = createActionsClient(
      stubOctokit({
        listForOrg: async () => ({
          data: [{ full_name: "acme/widgets", name: "widgets", owner: { login: "acme" } }],
        }),
      }),
    );

    const repos = await client.listOrgRepos("acme");
    expect(repos).toEqual([{ fullName: "acme/widgets", name: "widgets", owner: "acme" }]);
  });

  it("maps workflow runs and converts timestamps to Date objects", async () => {
    const client = createActionsClient(
      stubOctokit({
        listWorkflowRunsForRepo: async () => ({
          data: {
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
          },
        }),
      }),
    );

    const runs = await client.listRunsForRepo("acme", "widgets");
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
