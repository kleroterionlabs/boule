import type { DiscussionRef } from "../core/types.js";
import { BouleError } from "../util/errors.js";
// src/github/discussions.ts — categories are NOT API-creatable; we resolve, fail-fast if missing.
import type { GitHubClient } from "./client.js";
import { ADD_DISCUSSION_COMMENT, CREATE_DISCUSSION } from "./mutations.js";
import { DISCUSSION_CATEGORIES_QUERY, REPO_ID } from "./queries.js";

export interface ResolvedCategory {
  id: string;
  name: string;
  isAnswerable: boolean;
}

export async function resolveCategories(
  gh: GitHubClient,
  owner: string,
  name: string,
): Promise<{ repoId: string; categories: ResolvedCategory[] }> {
  const data = await gh.graphql<{
    repository: { id: string; discussionCategories: { nodes: ResolvedCategory[] } };
  }>("read", DISCUSSION_CATEGORIES_QUERY, { owner, name });
  return { repoId: data.repository.id, categories: data.repository.discussionCategories.nodes };
}

export function requireCategory(cats: ResolvedCategory[], name: string): ResolvedCategory {
  const found = cats.find((c) => c.name === name);
  if (!found) {
    throw new BouleError(
      `Discussion category "${name}" missing. Create it in repo Settings → Discussions (categories cannot be created via API).`,
    );
  }
  return found;
}

export async function postDiscussion(
  gh: GitHubClient,
  args: { repoId: string; categoryId: string; title: string; body: string; dryRun: boolean },
): Promise<DiscussionRef> {
  if (args.dryRun) return { number: -1, nodeId: "", url: "(dry-run)" };
  const data = await gh.graphql<{ createDiscussion: { discussion: DiscussionRef } }>(
    "write",
    CREATE_DISCUSSION,
    { repositoryId: args.repoId, categoryId: args.categoryId, title: args.title, body: args.body },
  );
  return data.createDiscussion.discussion;
}

export async function addComment(
  gh: GitHubClient,
  discussionId: string,
  body: string,
  replyToId?: string,
): Promise<void> {
  await gh.graphql("write", ADD_DISCUSSION_COMMENT, { discussionId, body, replyTo: replyToId ?? null });
}

export { REPO_ID };
