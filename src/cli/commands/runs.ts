// src/cli/commands/runs.ts — browse recorded runs from .boule/runs (the local history).
import type { Command } from "commander";
import { isUndone, listRunIds, loadReport } from "../../state/runStore.js";
import { globals } from "./_shared.js";

export function registerRuns(program: Command): void {
  program
    .command("runs [runId]")
    .description("List recent runs, or show one run's full report. Reverse a run with `boule undo`.")
    .option("--limit <n>", "how many runs to list", (v) => Number(v), 20)
    .action((runIdArg: string | undefined, local: { limit: number }, cmd: Command) => {
      const { json } = globals(cmd);

      if (runIdArg) {
        const report = loadReport(runIdArg);
        if (!report) {
          process.stderr.write(`No report for run ${runIdArg}.\n`);
          process.exitCode = 2;
          return;
        }
        if (json) {
          process.stdout.write(`${JSON.stringify({ ...report, undone: isUndone(runIdArg) })}\n`);
          return;
        }
        const m = report.metrics;
        const out = [
          `\nRun ${report.runId}  (${report.workflow})${isUndone(runIdArg) ? "  [UNDONE]" : ""}`,
          `  Result: ${report.ok ? "✓" : "✗"} ${report.stopReason}   ${report.numTurns} turns   $${report.costUsd.toFixed(4)}`,
          `  Wrote:  ${m.issuesCreated} created, ${m.issuesUpdated} updated, ${m.issuesClosed} closed, ${m.issuesNoop} unchanged · ${m.subIssuesLinked} links · ${m.projectItems} items (${m.projectItemsRemoved} removed) · ${m.discussionsPosted} discussions`,
        ];
        for (const ref of report.artifactsWritten) out.push(`    #${ref.number}  ${ref.url}`);
        if (report.errors.length) out.push(`  Errors: ${report.errors.length}`);
        process.stdout.write(`${out.join("\n")}\n`);
        return;
      }

      const ids = listRunIds().slice(0, Math.max(1, local.limit));
      if (json) {
        const rows = ids.map((id) => ({ runId: id, undone: isUndone(id), report: loadReport(id) }));
        process.stdout.write(`${JSON.stringify(rows)}\n`);
        return;
      }
      if (ids.length === 0) {
        process.stdout.write("No runs recorded yet.\n");
        return;
      }
      const out: string[] = [`\nRecent runs (newest first), showing ${ids.length}:`];
      for (const id of ids) {
        const r = loadReport(id);
        const undo = isUndone(id) ? " [UNDONE]" : "";
        if (!r) {
          out.push(`  ${id}  (no report)${undo}`);
          continue;
        }
        const m = r.metrics;
        const wrote = `${m.issuesCreated}c/${m.issuesUpdated}u/${m.issuesClosed}x`;
        out.push(
          `  ${id}  ${r.ok ? "✓" : "✗"} ${r.workflow.padEnd(12)} ${wrote.padStart(10)}  $${r.costUsd.toFixed(2)}${undo}`,
        );
      }
      out.push("\nShow one: boule runs <runId>   ·   Reverse: boule undo <runId>");
      process.stdout.write(`${out.join("\n")}\n`);
    });
}
