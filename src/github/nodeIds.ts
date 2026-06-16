// src/github/nodeIds.ts — opaque node-id resolution; results are cacheable (src/state/cache.ts).
import { BouleError } from "../util/errors.js";
import type { GitHubClient } from "./client.js";
import { PROJECT_BY_OWNER, REPO_ID } from "./queries.js";

export async function resolveRepoId(gh: GitHubClient, owner: string, name: string): Promise<string> {
  const data = await gh.graphql<{ repository: { id: string } }>("read", REPO_ID, { owner, name });
  return data.repository.id;
}

/** Resolve a Projects v2 board by its per-owner number, whether owned by an org or a user. */
export async function resolveProjectId(gh: GitHubClient, owner: string, number: number): Promise<string> {
  const data = await gh.graphql<{ repositoryOwner: { projectV2: { id: string } | null } | null }>(
    "read",
    PROJECT_BY_OWNER,
    { login: owner, number },
  );
  const id = data.repositoryOwner?.projectV2?.id;
  if (!id) throw new BouleError(`Projects v2 #${number} not found for "${owner}".`);
  return id;
}
