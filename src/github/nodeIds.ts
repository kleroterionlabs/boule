// src/github/nodeIds.ts — opaque node-id resolution; results are cacheable (src/state/cache.ts).
import type { GitHubClient } from "./client.js";
import { REPO_ID } from "./queries.js";

export async function resolveRepoId(gh: GitHubClient, owner: string, name: string): Promise<string> {
  const data = await gh.graphql<{ repository: { id: string } }>("read", REPO_ID, { owner, name });
  return data.repository.id;
}

export async function resolveProjectId(gh: GitHubClient, org: string, number: number): Promise<string> {
  const data = await gh.graphql<{ organization: { projectV2: { id: string } } }>(
    "read",
    /* GraphQL */ "query($org: String!, $n: Int!) { organization(login: $org) { projectV2(number: $n) { id } } }",
    { org, n: number },
  );
  return data.organization.projectV2.id;
}
