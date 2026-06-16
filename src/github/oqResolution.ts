// src/github/oqResolution.ts — GitHub side of Open-Question resolution: read comments, enforce that
// only write/admin collaborators can reconcile, and persist the edited body (refreshing the boule block).
import type { ArtifactKind } from "../core/types.js";
import { type Resolution, applyResolutions, extractAnswersFromText } from "../quality/openQuestions.js";
import { parseBouleBlock, stripBouleBlock, withBouleBlock } from "../util/idempotency.js";
import { sanitizeMentions } from "../util/mentions.js";
import type { GitHubClient } from "./client.js";

/** Permission levels that may reconcile an artifact (answer Open Questions). */
const RECONCILE_PERMS = new Set(["admin", "write", "maintain"]);

export function canReconcile(permission: string): boolean {
  return RECONCILE_PERMS.has(permission);
}

/** A commenter's repo permission, or "none" if not a collaborator / lookup fails. */
export async function authorPermission(
  gh: GitHubClient,
  owner: string,
  name: string,
  username: string,
): Promise<string> {
  try {
    const res = await gh.withRest("read", (o) =>
      o.repos.getCollaboratorPermissionLevel({ owner, repo: name, username }),
    );
    return res.data.permission; // "admin" | "write" | "read" | "none"
  } catch {
    return "none";
  }
}

export interface CommentAnswer {
  id: string;
  answer: string;
  by: string;
  authorized: boolean;
  permission: string;
}

/**
 * Pull `OQ<n>: <answer>` answers from an issue's comments, tagging each with whether its author has
 * write/admin access. Caller decides what to do with unauthorized ones (we report, never apply them).
 */
export async function gatherCommentAnswers(
  gh: GitHubClient,
  owner: string,
  name: string,
  issueNumber: number,
): Promise<CommentAnswer[]> {
  const res = await gh.withRest("read", (o) =>
    o.issues.listComments({ owner, repo: name, issue_number: issueNumber, per_page: 100 }),
  );
  const out: CommentAnswer[] = [];
  const permCache = new Map<string, string>();
  for (const c of res.data) {
    const login = c.user?.login;
    if (!login || !c.body) continue;
    const answers = extractAnswersFromText(c.body, login);
    if (answers.length === 0) continue;
    if (!permCache.has(login)) {
      permCache.set(login, await authorPermission(gh, owner, name, login));
    }
    const permission = permCache.get(login) ?? "none";
    const authorized = canReconcile(permission);
    for (const a of answers) {
      out.push({ id: a.id, answer: a.answer, by: login, authorized, permission });
    }
  }
  return out;
}

export interface ApplyResult {
  number: number;
  url: string;
  applied: Resolution[];
}

/** Edit the issue body to record the resolutions, refreshing the boule block + posting an audit comment. */
export async function persistResolutions(
  gh: GitHubClient,
  args: {
    owner: string;
    name: string;
    number: number;
    url: string;
    body: string;
    resolutions: Resolution[];
    today: string;
    dryRun: boolean;
  },
): Promise<ApplyResult> {
  const block = parseBouleBlock(args.body);
  if (!block) throw new Error(`issue #${args.number} has no boule block — not a Boule-managed artifact`);

  // Answers are human/comment text — neutralize @-mentions so a Boule-authored body never tags people.
  const resolutions = args.resolutions.map((r) => ({ ...r, answer: sanitizeMentions(r.answer).clean }));

  const clean = stripBouleBlock(args.body);
  const newBody = withBouleBlock(applyResolutions(clean, resolutions, args.today), {
    kind: block.kind as ArtifactKind,
    bouleId: block.bouleId,
    ...(block.parent ? { parent: block.parent } : {}),
    ...(block.runId ? { runId: block.runId } : {}),
    ...(block.generatedBy ? { generatedBy: block.generatedBy } : {}),
  });

  if (!args.dryRun) {
    await gh.withRest("write", (o) =>
      o.issues.update({ owner: args.owner, repo: args.name, issue_number: args.number, body: newBody }),
    );
    const lines = resolutions.map(
      (r) => `- **${r.id}** (${r.source}${r.by ? ` · @${r.by}` : ""}): ${r.answer}`,
    );
    await gh.withRest("write", (o) =>
      o.issues.createComment({
        owner: args.owner,
        repo: args.name,
        issue_number: args.number,
        body: `🧩 Boule resolved ${resolutions.length} open question(s):\n\n${lines.join("\n")}\n\nRun \`boule sync\` to reconcile any downstream artifacts.`,
      }),
    );
  }
  return { number: args.number, url: args.url, applied: resolutions };
}
