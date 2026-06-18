// src/ci-health/client.ts — typed Actions API surface for the CI-health feature slice.
// Wraps an Octokit instance, exposing only the two endpoints the feature needs and
// mapping the raw Actions API responses into the internal `WorkflowRun` domain shape.

import type { Octokit } from "@octokit/rest";
import type { WorkflowRun } from "./types.js";

/** Minimal description of an organization repository. */
export interface OrgRepo {
  /** `owner/repo` full name. */
  fullName: string;
  /** Bare repository name. */
  name: string;
  /** Login of the repository owner. */
  owner: string;
}

/** A typed client exposing the GitHub Actions endpoints used by CI-health. */
export interface ActionsClient {
  /** `GET /orgs/{org}/repos` — list repositories owned by an organization. */
  listOrgRepos(org: string): Promise<OrgRepo[]>;
  /** `GET /repos/{owner}/{repo}/actions/runs` — list workflow runs for a repo. */
  listRunsForRepo(owner: string, repo: string): Promise<WorkflowRun[]>;
}

type ListOrgReposResponse = Awaited<ReturnType<Octokit["rest"]["repos"]["listForOrg"]>>["data"];
type ListWorkflowRunsResponse = Awaited<
  ReturnType<Octokit["rest"]["actions"]["listWorkflowRunsForRepo"]>
>["data"];

function mapRepo(repo: ListOrgReposResponse[number]): OrgRepo {
  return {
    fullName: repo.full_name,
    name: repo.name,
    owner: repo.owner.login,
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

/** Build an {@link ActionsClient} backed by the given Octokit instance. */
export function createActionsClient(octokit: Octokit): ActionsClient {
  return {
    async listOrgRepos(org: string): Promise<OrgRepo[]> {
      const { data } = await octokit.rest.repos.listForOrg({ org });
      return data.map(mapRepo);
    },
    async listRunsForRepo(owner: string, repo: string): Promise<WorkflowRun[]> {
      const { data } = await octokit.rest.actions.listWorkflowRunsForRepo({ owner, repo });
      return data.workflow_runs.map(mapRun);
    },
  };
}
