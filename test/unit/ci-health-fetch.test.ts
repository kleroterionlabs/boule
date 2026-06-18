import type { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONCURRENCY, fetchAllWorkflowRuns } from "../../src/ci-health/fetch.js";

/** Build a raw workflow-run API entry (snake_case, as the Actions API returns). */
function rawRun(over: { id: number; repo: string; createdAt: string }) {
  return {
    id: over.id,
    name: "CI",
    repository: { full_name: over.repo },
    status: "completed",
    conclusion: "success",
    head_sha: `sha-${over.id}`,
    head_branch: "main",
    created_at: over.createdAt,
    updated_at: over.createdAt,
    html_url: `https://github.com/${over.repo}/actions/runs/${over.id}`,
  };
}

/**
 * Stub Octokit whose `paginate` returns pre-flattened arrays (paginate already
 * concatenates pages), dispatching on the endpoint function it is handed.
 *
 * `reposByOwner` maps the repo bare name -> its flattened list of runs across pages.
 * `onRunsCall` is invoked for each runs fetch to allow concurrency / failure injection.
 */
function stubOctokit(opts: {
  orgRepos: Array<{ full_name: string; name: string; owner: { login: string } }>;
  runsByRepo: Record<string, ReturnType<typeof rawRun>[]>;
  onRunsCall?: (repo: string) => Promise<void>;
}): Octokit {
  const listForOrg = (() => {}) as unknown;
  const listWorkflowRunsForRepo = (() => {}) as unknown;

  const paginate = async (endpoint: unknown, params: { org?: string; repo?: string }): Promise<unknown[]> => {
    if (endpoint === listForOrg) {
      return opts.orgRepos;
    }
    if (endpoint === listWorkflowRunsForRepo) {
      const repo = params.repo as string;
      if (opts.onRunsCall) await opts.onRunsCall(repo);
      return opts.runsByRepo[repo] ?? [];
    }
    throw new Error("unexpected paginate endpoint");
  };

  return {
    paginate,
    rest: {
      repos: { listForOrg },
      actions: { listWorkflowRunsForRepo },
    },
  } as unknown as Octokit;
}

describe("fetchAllWorkflowRuns", () => {
  it("returns the union of all runs across repos (each paginated)", async () => {
    // 3 repos, each with 2 "pages" worth of runs already flattened by paginate.
    const octokit = stubOctokit({
      orgRepos: [
        { full_name: "acme/a", name: "a", owner: { login: "acme" } },
        { full_name: "acme/b", name: "b", owner: { login: "acme" } },
        { full_name: "acme/c", name: "c", owner: { login: "acme" } },
      ],
      runsByRepo: {
        a: [
          rawRun({ id: 1, repo: "acme/a", createdAt: "2024-01-01T00:00:00Z" }),
          rawRun({ id: 2, repo: "acme/a", createdAt: "2024-01-02T00:00:00Z" }),
        ],
        b: [
          rawRun({ id: 3, repo: "acme/b", createdAt: "2024-01-03T00:00:00Z" }),
          rawRun({ id: 4, repo: "acme/b", createdAt: "2024-01-04T00:00:00Z" }),
        ],
        c: [
          rawRun({ id: 5, repo: "acme/c", createdAt: "2024-01-05T00:00:00Z" }),
          rawRun({ id: 6, repo: "acme/c", createdAt: "2024-01-06T00:00:00Z" }),
        ],
      },
    });

    const { runs, errors } = await fetchAllWorkflowRuns(octokit, "acme", new Date(0));

    expect(errors).toEqual([]);
    expect(runs).toHaveLength(6);
    expect(runs.map((r) => r.id).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("sorts the combined runs by createdAt descending", async () => {
    const octokit = stubOctokit({
      orgRepos: [
        { full_name: "acme/a", name: "a", owner: { login: "acme" } },
        { full_name: "acme/b", name: "b", owner: { login: "acme" } },
      ],
      runsByRepo: {
        a: [
          rawRun({ id: 1, repo: "acme/a", createdAt: "2024-01-01T00:00:00Z" }),
          rawRun({ id: 5, repo: "acme/a", createdAt: "2024-01-05T00:00:00Z" }),
        ],
        b: [
          rawRun({ id: 3, repo: "acme/b", createdAt: "2024-01-03T00:00:00Z" }),
          rawRun({ id: 9, repo: "acme/b", createdAt: "2024-01-09T00:00:00Z" }),
        ],
      },
    });

    const { runs } = await fetchAllWorkflowRuns(octokit, "acme", new Date(0));

    expect(runs.map((r) => r.id)).toEqual([9, 5, 3, 1]);
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i - 1]!.createdAt.getTime()).toBeGreaterThanOrEqual(runs[i]!.createdAt.getTime());
    }
  });

  it("passes the since filter as a created:>ISO query to the runs endpoint", async () => {
    const seen: Array<{ repo?: string; created?: string }> = [];
    const since = new Date("2024-06-01T00:00:00Z");

    const listForOrg = (() => {}) as unknown;
    const listWorkflowRunsForRepo = (() => {}) as unknown;
    const octokit = {
      paginate: async (endpoint: unknown, params: { repo?: string; created?: string }) => {
        if (endpoint === listForOrg) {
          return [{ full_name: "acme/a", name: "a", owner: { login: "acme" } }];
        }
        seen.push({ repo: params.repo, created: params.created });
        return [];
      },
      rest: {
        repos: { listForOrg },
        actions: { listWorkflowRunsForRepo },
      },
    } as unknown as Octokit;

    await fetchAllWorkflowRuns(octokit, "acme", since);

    expect(seen).toEqual([{ repo: "a", created: `>${since.toISOString()}` }]);
  });

  it("never has more than the concurrency cap of in-flight repo fetches", async () => {
    const repoCount = 20;
    const orgRepos = Array.from({ length: repoCount }, (_, i) => ({
      full_name: `acme/r${i}`,
      name: `r${i}`,
      owner: { login: "acme" },
    }));
    const runsByRepo: Record<string, ReturnType<typeof rawRun>[]> = {};
    for (let i = 0; i < repoCount; i++) {
      runsByRepo[`r${i}`] = [rawRun({ id: i + 1, repo: `acme/r${i}`, createdAt: "2024-01-01T00:00:00Z" })];
    }

    let inFlight = 0;
    let maxInFlight = 0;
    const octokit = stubOctokit({
      orgRepos,
      runsByRepo,
      onRunsCall: async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
      },
    });

    const { runs } = await fetchAllWorkflowRuns(octokit, "acme", new Date(0));

    expect(runs).toHaveLength(repoCount);
    expect(maxInFlight).toBeLessThanOrEqual(DEFAULT_CONCURRENCY);
    expect(maxInFlight).toBeGreaterThan(1); // genuinely concurrent, not serialized
  });

  it("respects a custom concurrency option", async () => {
    const repoCount = 12;
    const orgRepos = Array.from({ length: repoCount }, (_, i) => ({
      full_name: `acme/r${i}`,
      name: `r${i}`,
      owner: { login: "acme" },
    }));
    const runsByRepo: Record<string, ReturnType<typeof rawRun>[]> = {};
    for (let i = 0; i < repoCount; i++) runsByRepo[`r${i}`] = [];

    let inFlight = 0;
    let maxInFlight = 0;
    const octokit = stubOctokit({
      orgRepos,
      runsByRepo,
      onRunsCall: async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
      },
    });

    await fetchAllWorkflowRuns(octokit, "acme", new Date(0), { concurrency: 3 });

    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it("collects per-repo failures into errors and returns partial results", async () => {
    const octokit = stubOctokit({
      orgRepos: [
        { full_name: "acme/ok", name: "ok", owner: { login: "acme" } },
        { full_name: "acme/bad", name: "bad", owner: { login: "acme" } },
      ],
      runsByRepo: {
        ok: [rawRun({ id: 1, repo: "acme/ok", createdAt: "2024-01-01T00:00:00Z" })],
      },
      onRunsCall: async (repo) => {
        if (repo === "bad") throw new Error("boom");
      },
    });

    const { runs, errors } = await fetchAllWorkflowRuns(octokit, "acme", new Date(0));

    expect(runs.map((r) => r.id)).toEqual([1]);
    expect(errors).toEqual([{ repoFullName: "acme/bad", message: "boom" }]);
  });

  it("logs failures at WARN level when a logger is supplied", async () => {
    const warnings: unknown[] = [];
    const logger = { warn: (...args: unknown[]) => warnings.push(args) } as never;

    const octokit = stubOctokit({
      orgRepos: [{ full_name: "acme/bad", name: "bad", owner: { login: "acme" } }],
      runsByRepo: {},
      onRunsCall: async () => {
        throw new Error("nope");
      },
    });

    const { errors } = await fetchAllWorkflowRuns(octokit, "acme", new Date(0), { logger });

    expect(errors).toHaveLength(1);
    expect(warnings).toHaveLength(1);
  });
});
