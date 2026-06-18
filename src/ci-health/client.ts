// src/ci-health/client.ts — typed Actions API surface for the CI-health feature slice.
// Wraps an Octokit instance, exposing only the two endpoints the feature needs and
// mapping the raw Actions API responses into the internal domain shapes.

import type { Octokit } from "@octokit/rest";
import { CiHealthFetchError, type RepoRef, type WorkflowRun } from "./types.js";

/** A typed client exposing the GitHub Actions endpoints used by CI-health. */
export interface ActionsClient {
  /** `GET /orgs/{org}/repos` — list active (non-archived, non-disabled) repositories. */
  listOrgRepos(org: string): Promise<RepoRef[]>;
  /** `GET /repos/{owner}/{repo}/actions/runs` — list workflow runs for a repo. */
  listRunsForRepo(owner: string, repo: string): Promise<WorkflowRun[]>;
}

type ListOrgReposResponse = Awaited<ReturnType<Octokit["rest"]["repos"]["listForOrg"]>>["data"];
type OrgRepo = ListOrgReposResponse[number];
type ListWorkflowRunsResponse = Awaited<
  ReturnType<Octokit["rest"]["actions"]["listWorkflowRunsForRepo"]>
>["data"];

function mapRepo(repo: OrgRepo): RepoRef {
  return {
    owner: repo.owner.login,
    name: repo.name,
    fullName: repo.full_name,
  };
}

function mapRun(run: ListWorkflowRunsResponse["workflow_runs"][number]): WorkflowRun {
  return {
    id: run.id,
    name: run.name ?? "",
    repoFullName: run.repository.full_name,
    status: run.status ?? null,
    conclusion: run.conclusion ?? null,
    headSha: run.head_sha,
    headBranch: run.head_branch ?? null,
    createdAt: new Date(run.created_at),
    updatedAt: new Date(run.updated_at),
    htmlUrl: run.html_url,
  };
}

/** Extract the HTTP status from an Octokit `RequestError`-shaped value, if present. */
function httpStatusOf(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error) {
    const { status } = error as { status: unknown };
    if (typeof status === "number") return status;
  }
  return undefined;
}

/** Build an {@link ActionsClient} backed by the given Octokit instance. */
export function createActionsClient(octokit: Octokit): ActionsClient {
  return {
    async listOrgRepos(org: string): Promise<RepoRef[]> {
      let repos: OrgRepo[];
      try {
        // `paginate` follows `Link` headers automatically, returning every page flattened.
        repos = await octokit.paginate(octokit.rest.repos.listForOrg, { org, per_page: 100 });
      } catch (error) {
        const status = httpStatusOf(error);
        const suffix = status === undefined ? "" : ` (HTTP ${status})`;
        throw new CiHealthFetchError(`Failed to list repositories for org "${org}"${suffix}`, status, {
          cause: error,
        });
      }
      return repos.filter((repo) => !repo.archived && !repo.disabled).map(mapRepo);
    },
    async listRunsForRepo(owner: string, repo: string): Promise<WorkflowRun[]> {
      const { data } = await octokit.rest.actions.listWorkflowRunsForRepo({ owner, repo });
      return data.workflow_runs.map(mapRun);
    },
  };
}
