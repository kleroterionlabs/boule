// src/ci-health/fetch.ts — fan-out fetch of GitHub Actions workflow runs across an org.
// Lists every repository in the org, then paginates each repo's workflow runs created
// after `since`, mapping them into the internal `WorkflowRun` domain shape. Repos are
// fetched concurrently with a bounded pool; per-repo failures are collected rather than
// aborting the whole fetch, so callers get partial results plus an `errors` array.

import type { Logger } from "@kleroterion/koine";
import type { Octokit } from "@octokit/rest";
import pLimit from "p-limit";
import { type OrgRepo, mapRepo, mapRun } from "./client.js";
import type { WorkflowRun } from "./types.js";

/** Maximum number of repos whose runs are fetched simultaneously. */
export const DEFAULT_CONCURRENCY = 5;

/** A repository that failed to fetch, with the reason. */
export interface FetchError {
  /** `owner/repo` full name of the repo that failed. */
  repoFullName: string;
  /** Human-readable failure message. */
  message: string;
}

/** Result envelope: the runs that were fetched plus any per-repo failures. */
export interface FetchResult {
  /** All successfully fetched runs, sorted by `createdAt` descending. */
  runs: WorkflowRun[];
  /** Repos that failed to fetch; empty when everything succeeded. */
  errors: FetchError[];
}

/** Optional knobs for {@link fetchAllWorkflowRuns}. */
export interface FetchOptions {
  /** Max repos fetched at once. Defaults to {@link DEFAULT_CONCURRENCY}. */
  concurrency?: number;
  /** Logger for WARN-level per-repo failure messages. */
  logger?: Logger;
}

/**
 * Fetch every workflow run created after `since` across all repositories in `org`.
 *
 * Repos are enumerated via `repos.listForOrg`, then each repo's runs are paginated
 * with `octokit.paginate(actions.listWorkflowRunsForRepo, …)`. Fetches run through a
 * concurrency-limited pool (default 5). A failure for one repo is logged at WARN and
 * recorded in the returned `errors` array without aborting the others. The combined
 * runs are returned as a flat array sorted by `createdAt` descending.
 */
export async function fetchAllWorkflowRuns(
  octokit: Octokit,
  org: string,
  since: Date,
  opts: FetchOptions = {},
): Promise<FetchResult> {
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const logger = opts.logger;

  const repoData = await octokit.paginate(octokit.rest.repos.listForOrg, {
    org,
    per_page: 100,
  });
  const repos: OrgRepo[] = repoData.map(mapRepo);

  const limit = pLimit(concurrency);
  const errors: FetchError[] = [];

  const perRepo = await Promise.all(
    repos.map((repo) =>
      limit(async (): Promise<WorkflowRun[]> => {
        try {
          const runData = await octokit.paginate(octokit.rest.actions.listWorkflowRunsForRepo, {
            owner: repo.owner,
            repo: repo.name,
            created: `>${since.toISOString()}`,
            per_page: 100,
          });
          return runData.map(mapRun);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push({ repoFullName: repo.fullName, message });
          logger?.warn(
            { repo: repo.fullName, err: message },
            "ci-health: failed to fetch workflow runs for repo",
          );
          return [];
        }
      }),
    ),
  );

  const runs = perRepo.flat().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return { runs, errors };
}
