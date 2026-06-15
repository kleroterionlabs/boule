// src/tools/githubTools.ts — agents never touch Octokit; they call these gated tools.
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { FieldRef } from "../core/types.js";
import type { GitHubClient } from "../github/client.js";
import { linkSubIssue, searchByBouleId, upsertIssue } from "../github/issues.js";
import { addItem, setItemFields } from "../github/projects.js";
import type { Logger } from "../observability/logger.js";

export interface ToolContext {
  gh: GitHubClient;
  repo: string;
  repositoryId: string;
  projectId?: string;
  projectSchema: Record<string, FieldRef>;
  runId: string;
  dryRun: boolean;
  log: Logger;
}

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data) }],
  structuredContent: data,
});
const fail = (msg: string) => ({ isError: true, content: [{ type: "text" as const, text: msg }] });

/** Build the in-process GitHub MCP server bound to a run's context. */
export function createGithubMcpServer(ctx: ToolContext) {
  return createSdkMcpServer({
    name: "github",
    version: "1.0.0",
    tools: [
      tool(
        "gh_search",
        "Read-only search for an existing boule artifact issue by its boule-id.",
        { bouleId: z.string() },
        async (args) => {
          try {
            return ok(await searchByBouleId(ctx.gh, ctx.repo, args.bouleId));
          } catch (e) {
            return fail(`gh_search error: ${String(e)}`);
          }
        },
      ),
      tool(
        "gh_upsert_issue",
        "Create or update a typed artifact issue, idempotent on boule-id.",
        {
          kind: z.enum(["design", "requirement", "competitor", "market", "gap", "epic", "feature", "task"]),
          bouleId: z.string(),
          title: z.string(),
          body: z.string(),
          labelIds: z.array(z.string()).default([]),
          issueTypeId: z.string().optional(),
          parent: z.string().optional(),
        },
        async (args) => {
          try {
            const res = await upsertIssue(ctx.gh, ctx.repo, {
              repositoryId: ctx.repositoryId,
              kind: args.kind,
              bouleId: args.bouleId,
              title: args.title,
              body: args.body,
              labelIds: args.labelIds,
              ...(args.issueTypeId !== undefined && { issueTypeId: args.issueTypeId }),
              ...(args.parent !== undefined && { parent: args.parent }),
              runId: ctx.runId,
              dryRun: ctx.dryRun,
            });
            return ok(res);
          } catch (e) {
            return fail(`gh_upsert_issue error: ${String(e)}`); // NEVER throw ⇒ keeps query() loop alive
          }
        },
      ),
      tool(
        "gh_link_sub_issue",
        "Link a child issue under a parent (native sub-issue).",
        { parentNodeId: z.string(), childNodeId: z.string() },
        async (args) => {
          try {
            if (!ctx.dryRun) await linkSubIssue(ctx.gh, args.parentNodeId, args.childNodeId);
            return ok({ linked: true, dryRun: ctx.dryRun });
          } catch (e) {
            return fail(`gh_link_sub_issue error: ${String(e)}`);
          }
        },
      ),
      tool(
        "gh_project_set_fields",
        "Add an issue to the project (if needed) and set Status/Kind/Priority/RICE field values.",
        {
          issueNodeId: z.string(),
          fields: z.record(z.union([z.string(), z.number()])),
        },
        async (args) => {
          try {
            if (!ctx.projectId) return fail("no project configured");
            if (ctx.dryRun) return ok({ planned: args.fields, dryRun: true });
            const itemId = await addItem(ctx.gh, ctx.projectId, args.issueNodeId);
            await setItemFields(ctx.gh, ctx.projectId, itemId, ctx.projectSchema, args.fields);
            return ok({ itemId });
          } catch (e) {
            return fail(`gh_project_set_fields error: ${String(e)}`);
          }
        },
      ),
    ],
  });
}
