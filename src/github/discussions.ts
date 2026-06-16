import type { DiscussionRef } from "../core/types.js";
import { BouleError } from "../util/errors.js";
// src/github/discussions.ts — categories are NOT API-creatable; we resolve, fail-fast if missing.
import type { GitHubClient } from "./client.js";
import { ADD_DISCUSSION_COMMENT, CREATE_DISCUSSION, UPDATE_DISCUSSION } from "./mutations.js";
import { DISCUSSIONS_IN_CATEGORY, DISCUSSION_CATEGORIES_QUERY, REPO_ID } from "./queries.js";

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

/** Hidden marker embedded in a discussion body so we can re-find it (e.g. the daily status). */
export function discussionMarker(key: string): string {
  return `<!-- boule:discussion:${key} -->`;
}

/**
 * Create-or-update a discussion identified by a stable `key` (e.g. "status:2026-06-15").
 * Lists the category (strongly consistent) and matches on the embedded marker — so re-running
 * the daily status edits the same thread instead of posting a duplicate.
 */
export async function upsertDiscussion(
  gh: GitHubClient,
  args: {
    owner: string;
    name: string;
    repoId: string;
    categoryId: string;
    key: string;
    title: string;
    body: string;
    dryRun: boolean;
  },
): Promise<{ ref: DiscussionRef; action: "create" | "update" }> {
  const marker = discussionMarker(args.key);
  const body = `${args.body}\n\n${marker}`;
  if (args.dryRun) return { ref: { number: -1, nodeId: "", url: "(dry-run)" }, action: "create" };

  const data = await gh.graphql<{
    repository: { discussions: { nodes: (DiscussionRef & { body: string })[] } };
  }>("read", DISCUSSIONS_IN_CATEGORY, {
    owner: args.owner,
    name: args.name,
    categoryId: args.categoryId,
  });
  const existing = data.repository.discussions.nodes.find((d) => d.body.includes(marker));

  if (existing) {
    const upd = await gh.graphql<{ updateDiscussion: { discussion: DiscussionRef } }>(
      "write",
      UPDATE_DISCUSSION,
      { discussionId: existing.nodeId, title: args.title, body },
    );
    return { ref: upd.updateDiscussion.discussion, action: "update" };
  }
  const created = await gh.graphql<{ createDiscussion: { discussion: DiscussionRef } }>(
    "write",
    CREATE_DISCUSSION,
    { repositoryId: args.repoId, categoryId: args.categoryId, title: args.title, body },
  );
  return { ref: created.createDiscussion.discussion, action: "create" };
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
