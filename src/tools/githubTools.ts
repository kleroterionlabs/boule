// src/tools/githubTools.ts — agents never touch Octokit; they call these gated tools in human terms
// (kind, boule-id, label/category names). The tool layer resolves names → node ids via RepoContext.
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { ISSUE_TYPE_NAMES, OPERATIONAL_LABELS, kindLabel } from "../core/taxonomy.js";
import type { ProjectFieldValues } from "../core/types.js";
import type { GitHubClient } from "../github/client.js";
import { postDiscussion, upsertDiscussion } from "../github/discussions.js";
import { closeIssue, findByBouleId, linkSubIssue, listIssues, upsertIssue } from "../github/issues.js";
import { addItem, listProjectItems, removeProjectItem, setItemFields } from "../github/projects.js";
import type { RepoContext } from "../github/resolve.js";
import type { Ledger } from "../observability/ledger.js";
import type { Logger } from "../observability/logger.js";
import { validateArtifact } from "../quality/validate.js";
import { cleanOutbound } from "../util/outbound.js";

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
        "Read-only: find an existing artifact issue by its stable boule-id. Returns found, number, url, " +
          "and the full issue body (markdown, including the boule:v1 block) — use it to read an existing " +
          "artifact's current content before updating or re-reviewing it, and to avoid creating duplicates.",
        { bouleId: z.string() },
        async (args) => {
          try {
            const found = await findByBouleId(gh, rc.owner, rc.name, args.bouleId);
            return ok(
              found
                ? { found: true, number: found.number, url: found.url, body: found.body }
                : { found: false },
            );
          } catch (e) {
            return fail(`gh_find_issue error: ${String(e)}`);
          }
        },
      ),

      tool(
        "gh_list_issues",
        "Read-only: enumerate repository issues for triage/reconnaissance (there is no other way to " +
          "list issues). Filter by state (open|closed|all, default open), a single label, kind " +
          "(e.g. 'task'), managedOnly (boule-managed issues only), or since (ISO-8601 — only issues " +
          "updated on/after). Filters combine with AND. Returns number, title, url, state, labels, kind, " +
          "boule-id, managed flag, openQuestions (count of UNRESOLVED Open Questions — 0 means none are " +
          "outstanding) and updatedAt — NOT bodies; fetch a body with gh_find_issue if needed. " +
          "Results are capped at `max`; if `truncated` is true, narrow with filters.",
        {
          state: z.enum(["open", "closed", "all"]).default("open"),
          label: z.string().optional(),
          kind: KIND.optional(),
          managedOnly: z.boolean().default(false),
          since: z.string().optional().describe("ISO-8601; only issues updated on/after this time"),
          max: z.number().int().positive().max(500).default(200),
        },
        async (args) => {
          try {
            const labels: string[] = [];
            if (args.label) labels.push(args.label);
            if (args.kind) labels.push(kindLabel(args.kind));
            if (args.managedOnly) labels.push(OPERATIONAL_LABELS.managed);
            const { issues, truncated } = await listIssues(gh, rc.owner, rc.name, {
              state: args.state,
              ...(labels.length ? { labels } : {}),
              ...(args.since ? { since: args.since } : {}),
              max: args.max,
            });
            return ok({ count: issues.length, truncated, issues });
          } catch (e) {
            return fail(`gh_list_issues error: ${String(e)}`);
          }
        },
      ),

      tool(
        "gh_list_project_items",
        "Read-only: list the Projects v2 board items with their backing issue (number/title/url/state) " +
          "and current field values (Status, Kind, Priority, RICE, …) — the only way to read board " +
          "state for status summaries, triage, and sync reconciliation. Returns each item's itemId " +
          "(pass it to gh_remove_project_item to prune). Capped; narrow scope if `truncated` is true.",
        { max: z.number().int().positive().max(1000).default(500) },
        async (args) => {
          try {
            if (!rc.projectId) return fail("no Projects v2 board configured (set projectNumber)");
            const { items, truncated } = await listProjectItems(gh, rc.projectId, args.max);
            return ok({ count: items.length, truncated, items });
          } catch (e) {
            return fail(`gh_list_project_items error: ${String(e)}`);
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
            const body = cleanOutbound(args.body);
            if (body.secrets.length) {
              ctx.log.warn(
                { found: body.secrets, bouleId: args.bouleId },
                "redacted secrets from issue body",
              );
            }
            if (body.mentions.length) {
              ctx.log.warn(
                { stripped: body.mentions, bouleId: args.bouleId },
                "neutralized @-mentions in issue body",
              );
            }
            // Methodology gate (design §3): block the write on structural failures so the agent fixes
            // and retries; warnings are advisory. This is the deterministic backstop behind the Critic.
            const v = validateArtifact(args.kind, body.clean);
            if (v.warnings.length) {
              ctx.log.warn({ warnings: v.warnings, bouleId: args.bouleId }, "artifact validation warnings");
            }
            if (!v.ok) {
              return fail(
                `artifact ${args.bouleId} (${args.kind}) failed validation: ${v.errors.join("; ")}. Fix the draft and call gh_upsert_issue again.`,
              );
            }
            const res = await upsertIssue(gh, {
              owner: rc.owner,
              name: rc.name,
              kind: args.kind,
              bouleId: args.bouleId,
              title: cleanOutbound(args.title).clean,
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
          "daily status update. The category must already exist (categories can't be created via API). " +
          "Pass `key` for an idempotent post (e.g. key='status:2026-06-15' for the daily status): a prior " +
          "discussion with the same key is EDITED in place instead of duplicated. Omit `key` for an " +
          "append-only post (each call creates a new thread, e.g. a one-off handoff).",
        { category: z.string(), title: z.string(), body: z.string(), key: z.string().optional() },
        async (args) => {
          try {
            const cat = rc.categories.find((c) => c.name.toLowerCase() === args.category.toLowerCase());
            if (!cat) {
              return fail(
                `discussion category "${args.category}" not found — create it in repo Settings → Discussions`,
              );
            }
            if (ctx.dryRun) {
              return ok({ planned: args.title, category: cat.name, key: args.key, dryRun: true });
            }
            const body = cleanOutbound(args.body);
            if (body.secrets.length)
              ctx.log.warn({ found: body.secrets }, "redacted secrets from discussion body");
            if (body.mentions.length)
              ctx.log.warn({ stripped: body.mentions }, "neutralized @-mentions in discussion body");
            const title = cleanOutbound(args.title).clean;

            if (args.key) {
              const { ref, action } = await upsertDiscussion(gh, {
                owner: rc.owner,
                name: rc.name,
                repoId: rc.repositoryId,
                categoryId: cat.id,
                key: args.key,
                title,
                body: body.clean,
                dryRun: false,
              });
              ctx.ledger.record({
                action: action === "update" ? "discussion.update" : "discussion.create",
                number: ref.number,
                nodeId: ref.nodeId,
                url: ref.url,
              });
              return ok({ ...ref, action });
            }

            const ref = await postDiscussion(gh, {
              repoId: rc.repositoryId,
              categoryId: cat.id,
              title,
              body: body.clean,
              dryRun: false,
            });
            ctx.ledger.record({
              action: "discussion.create",
              number: ref.number,
              nodeId: ref.nodeId,
              url: ref.url,
            });
            return ok({ ...ref, action: "create" });
          } catch (e) {
            return fail(`gh_post_discussion error: ${String(e)}`);
          }
        },
      ),

      tool(
        "gh_close_issue",
        "Close an artifact issue (by boule-id). Use reason 'not_planned' for duplicates/orphans " +
          "(triage --dedupe, sync --prune) and 'completed' for finished work. Closing does NOT remove " +
          "the issue from the board — call gh_remove_project_item for that.",
        {
          bouleId: z.string(),
          reason: z.enum(["not_planned", "completed"]).default("not_planned"),
        },
        async (args) => {
          try {
            const issue = await findByBouleId(gh, rc.owner, rc.name, args.bouleId);
            if (!issue) return fail(`no issue found for boule-id "${args.bouleId}"`);
            if (ctx.dryRun)
              return ok({ planned: "close", number: issue.number, reason: args.reason, dryRun: true });
            await closeIssue(gh, rc.owner, rc.name, issue.number, args.reason);
            ctx.ledger.record({
              action: "issue.close",
              bouleId: args.bouleId,
              number: issue.number,
              nodeId: issue.nodeId,
              url: issue.url,
            });
            return ok({ closed: true, number: issue.number, reason: args.reason });
          } catch (e) {
            return fail(`gh_close_issue error: ${String(e)}`);
          }
        },
      ),

      tool(
        "gh_remove_project_item",
        "Remove an item from the Projects v2 board by its itemId (from gh_list_project_items). This " +
          "only detaches the item from the board — it does NOT close or delete the backing issue.",
        { itemId: z.string() },
        async (args) => {
          try {
            if (!rc.projectId) return fail("no Projects v2 board configured (set projectNumber)");
            if (ctx.dryRun) return ok({ planned: "remove", itemId: args.itemId, dryRun: true });
            await removeProjectItem(gh, rc.projectId, args.itemId);
            ctx.ledger.record({ action: "project.item.remove", itemId: args.itemId });
            return ok({ removed: true, itemId: args.itemId });
          } catch (e) {
            return fail(`gh_remove_project_item error: ${String(e)}`);
          }
        },
      ),
    ],
  });
}
