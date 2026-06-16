// src/tools/githubTools.ts — agents never touch Octokit; they call these gated tools in human terms
// (kind, boule-id, label/category names). The tool layer resolves names → node ids via RepoContext.
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { ISSUE_TYPE_NAMES } from "../core/taxonomy.js";
import type { ProjectFieldValues } from "../core/types.js";
import type { GitHubClient } from "../github/client.js";
import { postDiscussion } from "../github/discussions.js";
import { findByBouleId, linkSubIssue, upsertIssue } from "../github/issues.js";
import { addItem, setItemFields } from "../github/projects.js";
import type { RepoContext } from "../github/resolve.js";
import type { Ledger } from "../observability/ledger.js";
import type { Logger } from "../observability/logger.js";
import { scrubSecrets } from "../util/secrets.js";

export interface ToolContext {
  gh: GitHubClient;
  rc: RepoContext;
  runId: string;
  dryRun: boolean;
  ledger: Ledger;
  log: Logger;
}

const KIND = z.enum([
  "design",
  "requirement",
  "competitor",
  "market",
  "gap",
  "epic",
  "feature",
  "task",
  "spike",
]);

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
  structuredContent: data as Record<string, unknown>,
});
const fail = (msg: string) => ({ isError: true, content: [{ type: "text" as const, text: msg }] });

/** Build the in-process GitHub MCP server bound to a run's resolved context. */
export function createGithubMcpServer(ctx: ToolContext) {
  const { gh, rc } = ctx;

  return createSdkMcpServer({
    name: "github",
    version: "1.0.0",
    tools: [
      tool(
        "gh_find_issue",
        "Read-only: find an existing artifact issue by its stable boule-id. Use before creating to avoid duplicates.",
        { bouleId: z.string() },
        async (args) => {
          try {
            const found = await findByBouleId(gh, rc.owner, rc.name, args.bouleId);
            return ok(found ? { found: true, number: found.number, url: found.url } : { found: false });
          } catch (e) {
            return fail(`gh_find_issue error: ${String(e)}`);
          }
        },
      ),

      tool(
        "gh_upsert_issue",
        "Create or update a typed artifact issue, idempotent on boule-id. Pass a stable boule-id " +
          "(e.g. 'design:passwordless-signin'). Optionally a parentBouleId to link it as a sub-issue.",
        {
          kind: KIND,
          bouleId: z.string().describe("stable identity, e.g. 'requirement:auth-otp'"),
          title: z.string(),
          body: z.string().describe("GitHub-flavored markdown; do NOT include the boule metadata block"),
          labels: z.array(z.string()).default([]),
          parentBouleId: z.string().optional(),
        },
        async (args) => {
          try {
            const typeName = ISSUE_TYPE_NAMES[args.kind as keyof typeof ISSUE_TYPE_NAMES];
            const body = scrubSecrets(args.body);
            if (body.found.length) {
              ctx.log.warn({ found: body.found, bouleId: args.bouleId }, "redacted secrets from issue body");
            }
            const res = await upsertIssue(gh, {
              owner: rc.owner,
              name: rc.name,
              kind: args.kind,
              bouleId: args.bouleId,
              title: scrubSecrets(args.title).clean,
              body: body.clean,
              extraLabels: args.labels,
              ...(typeName && rc.issueTypeNames.has(typeName) ? { typeName } : {}),
              ...(args.parentBouleId ? { parentBouleId: args.parentBouleId } : {}),
              runId: ctx.runId,
              dryRun: ctx.dryRun,
            });
            if (!ctx.dryRun) {
              ctx.ledger.record({
                action: `issue.${res.action}`,
                bouleId: args.bouleId,
                number: res.ref.number,
                nodeId: res.ref.nodeId,
                url: res.ref.url,
                hash: res.fingerprint,
              });
            }
            return ok(res);
          } catch (e) {
            return fail(`gh_upsert_issue error: ${String(e)}`); // NEVER throw ⇒ keeps query() loop alive
          }
        },
      ),

      tool(
        "gh_link_sub_issue",
        "Link a child artifact under a parent as a native sub-issue (both referenced by boule-id).",
        { parentBouleId: z.string(), childBouleId: z.string() },
        async (args) => {
          try {
            const [parent, child] = await Promise.all([
              findByBouleId(gh, rc.owner, rc.name, args.parentBouleId),
              findByBouleId(gh, rc.owner, rc.name, args.childBouleId),
            ]);
            if (!parent || !child) return fail("parent or child issue not found for the given boule-id(s)");
            if (!ctx.dryRun) {
              await linkSubIssue(gh, parent.nodeId, child.nodeId);
              ctx.ledger.record({
                action: "subissue.link",
                bouleId: args.childBouleId,
                number: child.number,
                nodeId: child.nodeId,
                url: child.url,
              });
            }
            return ok({ linked: true, parent: parent.number, child: child.number, dryRun: ctx.dryRun });
          } catch (e) {
            return fail(`gh_link_sub_issue error: ${String(e)}`);
          }
        },
      ),

      tool(
        "gh_project_set_fields",
        "Add an artifact issue (by boule-id) to the Projects v2 board and set field values by name " +
          "(e.g. Status, Kind, Priority, RICE).",
        { bouleId: z.string(), fields: z.record(z.union([z.string(), z.number()])) },
        async (args) => {
          try {
            if (!rc.projectId) return fail("no Projects v2 board configured (set projectNumber)");
            const issue = await findByBouleId(gh, rc.owner, rc.name, args.bouleId);
            if (!issue) return fail(`no issue found for boule-id "${args.bouleId}"`);
            if (ctx.dryRun) return ok({ planned: args.fields, dryRun: true });
            const itemId = await addItem(gh, rc.projectId, issue.nodeId);
            await setItemFields(
              gh,
              rc.projectId,
              itemId,
              rc.projectSchema,
              args.fields as ProjectFieldValues,
            );
            ctx.ledger.record({ action: "project.item", bouleId: args.bouleId, itemId });
            ctx.ledger.record({ action: "project.field", bouleId: args.bouleId, itemId });
            return ok({ itemId });
          } catch (e) {
            return fail(`gh_project_set_fields error: ${String(e)}`);
          }
        },
      ),

      tool(
        "gh_post_discussion",
        "Post a GitHub Discussion in a category (by name) — for agent collaboration/handoffs and the " +
          "daily status update. The category must already exist (categories can't be created via API).",
        { category: z.string(), title: z.string(), body: z.string() },
        async (args) => {
          try {
            const cat = rc.categories.find((c) => c.name.toLowerCase() === args.category.toLowerCase());
            if (!cat) {
              return fail(
                `discussion category "${args.category}" not found — create it in repo Settings → Discussions`,
              );
            }
            if (ctx.dryRun) return ok({ planned: args.title, category: cat.name, dryRun: true });
            const body = scrubSecrets(args.body);
            if (body.found.length)
              ctx.log.warn({ found: body.found }, "redacted secrets from discussion body");
            const ref = await postDiscussion(gh, {
              repoId: rc.repositoryId,
              categoryId: cat.id,
              title: scrubSecrets(args.title).clean,
              body: body.clean,
              dryRun: false,
            });
            ctx.ledger.record({
              action: "discussion.create",
              number: ref.number,
              nodeId: ref.nodeId,
              url: ref.url,
            });
            return ok(ref);
          } catch (e) {
            return fail(`gh_post_discussion error: ${String(e)}`);
          }
        },
      ),
    ],
  });
}
