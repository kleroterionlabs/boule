import { OPERATIONAL_LABELS, kindLabel } from "../core/taxonomy.js";
// src/github/issues.ts — the dedupe heart. Every artifact write goes through upsertIssue().
// Dedup is by a UNIQUE per-artifact label via the REST List Issues endpoint (strongly consistent,
// exact-match) — NOT issue search, which is tokenized full-text + eventually consistent and would
// let duplicates slip through. A create-then-reconcile pass converges concurrent races.
import type { ArtifactKind, IssueRef, UpsertResult } from "../core/types.js";
import { parseOpenQuestions, preserveResolutions } from "../quality/openQuestions.js";
import { contentHash, idLabel, parseBouleBlock, withBouleBlock } from "../util/idempotency.js";
import type { GitHubClient } from "./client.js";
import { ADD_SUB_ISSUE } from "./mutations.js";

export interface IssueSpec {
  owner: string;
  name: string; // repo name (without owner)
  kind: ArtifactKind;
  bouleId: string;
  title: string;
  body: string; // body WITHOUT the boule block; appended here
  extraLabels?: string[]; // additional label NAMES (id/kind/managed labels are added automatically)
  typeName?: string; // issue-type NAME — only pass one the org actually has
  parentBouleId?: string; // parent artifact; linked as a native sub-issue when present
  runId: string;
  dryRun: boolean;
}

interface FoundIssue {
  number: number;
  nodeId: string;
  url: string;
  body: string;
}

const DRY_REF: IssueRef = { number: -1, nodeId: "", url: "(dry-run)" };

function uniq(xs: string[]): string[] {
  return [...new Set(xs.filter(Boolean))];
}

/** List the artifact issues carrying an exact label (strongly consistent, unlike search). */
async function listByLabel(
  gh: GitHubClient,
  owner: string,
  name: string,
  label: string,
): Promise<FoundIssue[]> {
  const res = await gh.withRest("read", (o) =>
    o.issues.listForRepo({ owner, repo: name, labels: label, state: "all", per_page: 100 }),
  );
  return res.data
    .filter((i) => !i.pull_request)
    .map((i) => ({ number: i.number, nodeId: i.node_id, url: i.html_url, body: i.body ?? "" }));
}

const lowest = (xs: FoundIssue[]): FoundIssue => xs.reduce((a, b) => (a.number <= b.number ? a : b));

/** Kill-switch poll: true if any OPEN issue carries the `boule:halt` label. */
export async function isHalted(gh: GitHubClient, owner: string, name: string): Promise<boolean> {
  const res = await gh.withRest("read", (o) =>
    o.issues.listForRepo({ owner, repo: name, labels: OPERATIONAL_LABELS.halt, state: "open", per_page: 1 }),
  );
  return res.data.length > 0;
}

/** A managed artifact that still has unresolved Open Questions (for no-arg `boule resolve`). */
export interface OpenQuestionArtifact {
  number: number;
  url: string;
  body: string;
  title: string;
  bouleId: string | null; // null only for legacy issues missing a boule block
  openCount: number;
}

/** Open managed issues that still have unresolved Open Questions, lowest issue number first. */
export async function listOpenQuestionArtifacts(
  gh: GitHubClient,
  owner: string,
  name: string,
): Promise<OpenQuestionArtifact[]> {
  const res = await gh.withRest("read", (o) =>
    o.issues.listForRepo({
      owner,
      repo: name,
      labels: OPERATIONAL_LABELS.managed,
      state: "open",
      per_page: 100,
    }),
  );
  const out: OpenQuestionArtifact[] = [];
  for (const i of res.data) {
    if (i.pull_request) continue;
    const body = i.body ?? "";
    const openCount = parseOpenQuestions(body).length;
    if (openCount === 0) continue;
    out.push({
      number: i.number,
      url: i.html_url,
      body,
      title: i.title,
      bouleId: parseBouleBlock(body)?.bouleId ?? null,
      openCount,
    });
  }
  return out.sort((a, b) => a.number - b.number);
}

/** Resolve an existing artifact issue by its boule-id (canonical = lowest number). */
export async function findByBouleId(
  gh: GitHubClient,
  owner: string,
  name: string,
  bouleId: string,
): Promise<FoundIssue | null> {
  const found = await listByLabel(gh, owner, name, idLabel(bouleId));
  return found.length ? lowest(found) : null;
}

/** create | noop | update — never silently overwrites; posts an audit comment on update. */
export async function upsertIssue(gh: GitHubClient, spec: IssueSpec): Promise<UpsertResult> {
  const dedupe = idLabel(spec.bouleId);
  const labels = uniq([
    dedupe,
    kindLabel(spec.kind),
    OPERATIONAL_LABELS.managed,
    ...(spec.extraLabels ?? []),
  ]);
  const meta = {
    kind: spec.kind,
    bouleId: spec.bouleId,
    ...(spec.parentBouleId ? { parent: spec.parentBouleId } : {}),
    runId: spec.runId,
    generatedBy: "boule",
  };

  const existing = await listByLabel(gh, spec.owner, spec.name, dedupe);

  if (existing.length === 0) {
    const hash = contentHash(spec.body);
    if (spec.dryRun) return { action: "create", fingerprint: hash, ref: DRY_REF };
    let created = await createIssue(gh, spec, withBouleBlock(spec.body, meta), labels);
    created = await reconcile(gh, spec.owner, spec.name, dedupe, spec.runId, created);
    await maybeLinkParent(gh, spec, created.nodeId);
    return {
      action: "create",
      fingerprint: hash,
      ref: { number: created.number, nodeId: created.nodeId, url: created.url },
    };
  }

  const canonical = lowest(existing);
  const ref: IssueRef = { number: canonical.number, nodeId: canonical.nodeId, url: canonical.url };
  // Carry human resolutions forward: a re-run regenerates the body from the brief (re-opening answered
  // OQs, dropping the Decisions section) — merge the existing resolved state back in before hashing so
  // `boule resolve` edits survive and a clean re-run still converges to a no-op.
  const mergedBody = preserveResolutions(spec.body, canonical.body);
  const fullBody = withBouleBlock(mergedBody, meta);
  const hash = contentHash(mergedBody);
  const prev = parseBouleBlock(canonical.body);
  if (prev?.contentHash === hash) return { action: "noop", fingerprint: hash, ref };

  if (!spec.dryRun) {
    await gh.withRest("write", (o) =>
      o.issues.update({ owner: spec.owner, repo: spec.name, issue_number: canonical.number, body: fullBody }),
    );
    await gh.withRest("write", (o) =>
      o.issues.createComment({
        owner: spec.owner,
        repo: spec.name,
        issue_number: canonical.number,
        body: auditComment(prev?.contentHash, hash, spec.runId),
      }),
    );
    await maybeLinkParent(gh, spec, canonical.nodeId);
  }
  return { action: "update", fingerprint: hash, ref };
}

async function createIssue(
  gh: GitHubClient,
  spec: IssueSpec,
  body: string,
  labels: string[],
): Promise<FoundIssue> {
  // REST auto-creates any missing labels and accepts the issue type by name (GA Mar 2025).
  const res = await gh.withRest("write", (o) =>
    o.request("POST /repos/{owner}/{repo}/issues", {
      owner: spec.owner,
      repo: spec.name,
      title: spec.title,
      body,
      labels,
      ...(spec.typeName ? { type: spec.typeName } : {}),
    }),
  );
  return {
    number: res.data.number,
    nodeId: res.data.node_id,
    url: res.data.html_url,
    body: res.data.body ?? body,
  };
}

/** Race backstop: if a concurrent run created the same artifact, keep the lowest number; close the rest. */
async function reconcile(
  gh: GitHubClient,
  owner: string,
  name: string,
  dedupe: string,
  runId: string,
  created: FoundIssue,
): Promise<FoundIssue> {
  const all = await listByLabel(gh, owner, name, dedupe);
  if (all.length <= 1) return created;
  const canonical = lowest(all);
  for (const dup of all) {
    if (dup.number === canonical.number) continue;
    await gh.withRest("write", (o) =>
      o.issues.createComment({
        owner,
        repo: name,
        issue_number: dup.number,
        body: `<!-- boule:reconcile run-id=${runId} -->\n🤖 Duplicate of #${canonical.number}; closed by boule reconcile.`,
      }),
    );
    await gh.withRest("write", (o) =>
      o.issues.update({
        owner,
        repo: name,
        issue_number: dup.number,
        state: "closed",
        state_reason: "not_planned",
      }),
    );
  }
  return canonical;
}

async function maybeLinkParent(gh: GitHubClient, spec: IssueSpec, childNodeId: string): Promise<void> {
  if (!spec.parentBouleId) return;
  const parent = await findByBouleId(gh, spec.owner, spec.name, spec.parentBouleId);
  if (parent) await linkSubIssue(gh, parent.nodeId, childNodeId);
}

/** Attach a child issue under a parent as a native sub-issue. issueId=parent, subIssueId=child. */
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
