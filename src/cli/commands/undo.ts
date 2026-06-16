// src/cli/commands/undo.ts — reverse a prior run's writes from its on-disk ledger.
import type { Command } from "commander";
import { ulid } from "ulid";
import { resolveAuth } from "../../config/auth.js";
import { type CliFlags, loadConfig } from "../../config/load.js";
import { createGitHubClient } from "../../github/client.js";
import { buildRepoContext } from "../../github/resolve.js";
import { createLogger } from "../../observability/logger.js";
import { listRunIds, loadLedger, persistUndo } from "../../state/runStore.js";
import { reverseRun } from "../../state/undo.js";
import { globals } from "./_shared.js";

export function registerUndo(program: Command): void {
  program
    .command("undo [runId]")
    .description(
      "Reverse a run's writes: close created issues, delete created discussions & board items " +
        "(updates/field-sets have no prior snapshot and are reported). Pass a run id, or --last.",
    )
    .option("--last", "undo the most recent recorded run", false)
    .action(async (runIdArg: string | undefined, local: { last?: boolean }, cmd: Command) => {
      const global = globals(cmd);
      const cfg = loadConfig({ cwd: process.cwd(), env: process.env, cli: global as CliFlags });

      const runId = runIdArg ?? (local.last ? listRunIds()[0] : undefined);
      if (!runId) {
        process.stderr.write("usage: boule undo <runId>   (or: boule undo --last)\n");
        process.exitCode = 2;
        return;
      }
      const entries = loadLedger(runId);
      if (entries.length === 0) {
        process.stderr.write(
          `No ledger for run ${runId} — nothing to undo (unknown run, or it was a dry run).\n`,
        );
        process.exitCode = 2;
        return;
      }

      const log = createLogger(cfg, `undo-${ulid()}`);
      const auth = resolveAuth(process.env);
      const gh = await createGitHubClient(auth, log);
      const rc = await buildRepoContext(gh, cfg, log);

      const report = await reverseRun(gh, {
        owner: rc.owner,
        name: rc.name,
        ...(rc.projectId ? { projectId: rc.projectId } : {}),
        entries,
        runId,
        dryRun: cfg.flags.dryRun,
        log,
      });

      if (global.json) {
        process.stdout.write(`${JSON.stringify(report)}\n`);
      } else {
        const out: string[] = [`\n${report.dryRun ? "Would undo" : "Undid"} run ${runId}:`];
        if (report.closedIssues.length)
          out.push(`  Closed issues: ${report.closedIssues.map((n) => `#${n}`).join(", ")}`);
        if (report.deletedDiscussions.length)
          out.push(`  Deleted discussions: ${report.deletedDiscussions.map((n) => `#${n}`).join(", ")}`);
        if (report.removedItems) out.push(`  Removed ${report.removedItems} board item(s)`);
        if (report.skipped.length)
          out.push(
            `  Skipped ${report.skipped.length} (updates/field-sets/links have no auto-reverse — review manually)`,
          );
        if (report.errors.length) {
          out.push("  Errors:");
          for (const e of report.errors) out.push(`    - ${e}`);
        }
        if (out.length === 1) out.push("  (nothing reversible)");
        process.stdout.write(`${out.join("\n")}\n`);
      }

      if (!report.dryRun) persistUndo(runId, report);
      if (report.errors.length) process.exitCode = 1;
    });
}
