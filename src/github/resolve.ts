// src/github/resolve.ts — resolve everything name→node-id ONCE per run, so agents work in
// human terms (kind, label names, category names) and the tool layer translates to node ids.
import type { Config } from "../config/schema.js";
import type { FieldRef } from "../core/types.js";
import type { Logger } from "../observability/logger.js";
import type { GitHubClient } from "./client.js";
import { type ResolvedCategory, resolveCategories } from "./discussions.js";
import { resolveProjectId, resolveRepoId } from "./nodeIds.js";
import { readProjectSchema } from "./projects.js";
import { ORG_ISSUE_TYPES } from "./queries.js";

export interface RepoContext {
  owner: string;
  name: string;
  repo: string; // owner/name
  repositoryId: string;
  /** Issue-type names defined on the owning org (empty for user-owned repos → fall back to labels). */
  issueTypeNames: Set<string>;
  projectId?: string;
  projectSchema: Record<string, FieldRef>;
  categories: ResolvedCategory[];
}

export async function buildRepoContext(gh: GitHubClient, cfg: Config, log: Logger): Promise<RepoContext> {
  const [owner, name] = cfg.repo.split("/") as [string, string];
  const repositoryId = await resolveRepoId(gh, owner, name);

  // Issue types are an org-level feature; user repos / disabled orgs simply yield none.
  const issueTypeNames = await resolveIssueTypeNames(gh, owner).catch(() => new Set<string>());
  // Discussions may be disabled on the repo; degrade gracefully (posting will error clearly later).
  const categories = await resolveCategories(gh, owner, name)
    .then((r) => r.categories)
    .catch(() => [] as ResolvedCategory[]);

  let projectId: string | undefined;
  let projectSchema: Record<string, FieldRef> = {};
  if (cfg.projectNumber) {
    projectId = await resolveProjectId(gh, owner, cfg.projectNumber);
    projectSchema = await readProjectSchema(gh, projectId);
  }

  log.info(
    {
      repositoryId,
      issueTypes: issueTypeNames.size,
      project: Boolean(projectId),
      categories: categories.length,
    },
    "repo context resolved",
  );

  return {
    owner,
    name,
    repo: cfg.repo,
    repositoryId,
    issueTypeNames,
    ...(projectId ? { projectId } : {}),
    projectSchema,
    categories,
  };
}

async function resolveIssueTypeNames(gh: GitHubClient, owner: string): Promise<Set<string>> {
  const data = await gh.graphql<{
    organization: { issueTypes: { nodes: { id: string; name: string }[] } } | null;
  }>("read", ORG_ISSUE_TYPES, { org: owner });
  return new Set((data.organization?.issueTypes.nodes ?? []).map((n) => n.name));
}
