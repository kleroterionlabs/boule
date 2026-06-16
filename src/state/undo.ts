// src/state/undo.ts — reverse a run's writes from its ledger. Reversible mutations only:
// created issues are CLOSED (not deleted — GitHub keeps history), created discussions and project
// items are removed. Updates/field-sets can't be auto-restored (no prior snapshot) and are reported.
import type { GitHubClient } from "../github/client.js";
import { ADD_COMMENT, CLOSE_ISSUE, DELETE_DISCUSSION, DELETE_PROJECT_ITEM } from "../github/mutations.js";
import type { LedgerEntry } from "../observability/ledger.js";
import type { Logger } from "../observability/logger.js";

export interface UndoReport {
  runId: string;
  dryRun: boolean;
  closedIssues: number[];
  deletedDiscussions: number[];
  removedItems: number;
  skipped: { action: string; ref: string }[];
  errors: string[];
}

export interface ReverseArgs {
  owner: string;
  name: string;
  projectId?: string;
  entries: LedgerEntry[];
  runId: string;
  dryRun: boolean;
  log: Logger;
}

const refOf = (e: LedgerEntry): string => e.bouleId ?? (e.number != null ? `#${e.number}` : "?");

/** Reverse a run's reversible mutations. Processes newest-first so links/items go before closes. */
export async function reverseRun(gh: GitHubClient, args: ReverseArgs): Promise<UndoReport> {
  const report: UndoReport = {
    runId: args.runId,
    dryRun: args.dryRun,
    closedIssues: [],
    deletedDiscussions: [],
    removedItems: 0,
    skipped: [],
    errors: [],
  };

  for (const e of [...args.entries].reverse()) {
    try {
      switch (e.action) {
        case "issue.create": {
          if (!e.nodeId || e.number == null) {
            report.skipped.push({ action: e.action, ref: refOf(e) });
            break;
          }
          if (!args.dryRun) {
            await gh.graphql("write", CLOSE_ISSUE, { id: e.nodeId });
            await gh.graphql("write", ADD_COMMENT, {
              subjectId: e.nodeId,
              body: `Reverted by \`boule undo ${args.runId}\` — this issue was created by that run.`,
            });
          }
          report.closedIssues.push(e.number);
          break;
        }
        case "discussion.create": {
          if (!e.nodeId || e.number == null) {
            report.skipped.push({ action: e.action, ref: refOf(e) });
            break;
          }
          if (!args.dryRun) await gh.graphql("write", DELETE_DISCUSSION, { id: e.nodeId });
          report.deletedDiscussions.push(e.number);
          break;
        }
        case "project.item": {
          if (!args.projectId || !e.itemId) {
            report.skipped.push({ action: e.action, ref: refOf(e) });
            break;
          }
          if (!args.dryRun) {
            await gh.graphql("write", DELETE_PROJECT_ITEM, {
              projectId: args.projectId,
              itemId: e.itemId,
            });
          }
          report.removedItems++;
          break;
        }
        // No prior snapshot to restore (updates) or implicitly handled (field clears with its item,
        // sub-issue link clears when the created child closes, noop changed nothing).
        default:
          report.skipped.push({ action: e.action, ref: refOf(e) });
          break;
      }
    } catch (err) {
      report.errors.push(`${e.action} ${refOf(e)}: ${String(err)}`);
      args.log.warn({ action: e.action, ref: refOf(e), err: String(err) }, "undo step failed");
    }
  }
  return report;
}
