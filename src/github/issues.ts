import type { IssueRef, UpsertResult } from "../core/types.js";
import type { ArtifactKind } from "../core/types.js";
import { contentHash, parseBouleBlock, withBouleBlock } from "../util/idempotency.js";
// src/github/issues.ts — the dedupe heart. Every artifact write goes through upsertIssue().
import type { GitHubClient } from "./client.js";
import { ADD_COMMENT, ADD_SUB_ISSUE, CREATE_ISSUE, UPDATE_ISSUE_BODY } from "./mutations.js";
import { SEARCH_BY_BOULE_ID } from "./queries.js";

export interface IssueSpec {
  repositoryId: string; // R_… node id
  kind: ArtifactKind;
  bouleId: string;
  title: string;
  body: string; // body WITHOUT the boule block; we append it here
  labelIds: string[];
  issueTypeId?: string; // IT_… when native types available
  parent?: string; // parent bouleId (resolved by caller / orchestrator)
  runId: string;
  dryRun: boolean;
}

interface FoundIssue {
  number: number;
  nodeId: string;
  url: string;
  body: string;
}

export async function searchByBouleId(
  gh: GitHubClient,
  repo: string,
  bouleId: string,
): Promise<FoundIssue | null> {
  const data = await gh.graphql<{ search: { nodes: FoundIssue[] } }>("read", SEARCH_BY_BOULE_ID, {
    q: `repo:${repo} in:body "boule-id: ${bouleId}"`,
  });
  return data.search.nodes[0] ?? null;
}

/** create | noop | update — never silently overwrites; posts an audit comment on update. */
export async function upsertIssue(gh: GitHubClient, repo: string, spec: IssueSpec): Promise<UpsertResult> {
  const fullBody = withBouleBlock(spec.body, {
    kind: spec.kind,
    bouleId: spec.bouleId,
    parent: spec.parent,
    runId: spec.runId,
    generatedBy: "boule",
  });
  const hash = contentHash(spec.body);
  const existing = await searchByBouleId(gh, repo, spec.bouleId);

  if (!existing) {
    if (spec.dryRun) {
      return { action: "create", fingerprint: hash, ref: { number: -1, nodeId: "", url: "(dry-run)" } };
    }
    const res = await gh.graphql<{ createIssue: { issue: IssueRef } }>("write", CREATE_ISSUE, {
      repositoryId: spec.repositoryId,
      title: spec.title,
      body: fullBody,
      labelIds: spec.labelIds,
      issueTypeId: spec.issueTypeId ?? null,
    });
    return { action: "create", fingerprint: hash, ref: res.createIssue.issue };
  }

  const prev = parseBouleBlock(existing.body);
  const ref: IssueRef = { number: existing.number, nodeId: existing.nodeId, url: existing.url };
  if (prev?.contentHash === hash) return { action: "noop", fingerprint: hash, ref };

  if (!spec.dryRun) {
    await gh.graphql("write", UPDATE_ISSUE_BODY, { id: existing.nodeId, body: fullBody });
    await gh.graphql("write", ADD_COMMENT, {
      subjectId: existing.nodeId,
      body: auditComment(prev?.contentHash, hash, spec.runId),
    });
  }
  return { action: "update", fingerprint: hash, ref };
}

export async function linkSubIssue(
  gh: GitHubClient,
  parentNodeId: string,
  childNodeId: string,
): Promise<void> {
  await gh.graphql("write", ADD_SUB_ISSUE, { issueId: parentNodeId, subIssueId: childNodeId });
}

function auditComment(prevHash: string | undefined, nextHash: string, runId: string): string {
  return [
    `<!-- boule:audit run-id=${runId} -->`,
    `🤖 **boule** updated this issue · run \`${runId}\``,
    `- content-hash \`${prevHash ?? "(none)"}\` → \`${nextHash}\``,
  ].join("\n");
}
