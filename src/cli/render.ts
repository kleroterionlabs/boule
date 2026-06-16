// src/cli/render.ts — turns an AgentRunResult into human output (default) or NDJSON (--json).
import type { AgentRunResult } from "../core/types.js";

export function renderRunSummary(result: AgentRunResult, opts: { json: boolean }): void {
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  const out: string[] = [];
  out.push(`\n${result.ok ? "✓" : "✗"} boule ${result.workflow} — ${result.stopReason}`);
  out.push(`  Run: ${result.runId}${result.resumedFrom ? ` (resumed from ${result.resumedFrom})` : ""}`);

  if (result.artifactsWritten.length) {
    out.push("  Issues:");
    for (const ref of result.artifactsWritten) out.push(`    #${ref.number}  ${ref.url}`);
  }
  if (result.skippedDuplicates.length) {
    out.push(
      `  Skipped ${result.skippedDuplicates.length} existing (idempotent): ${result.skippedDuplicates.join(", ")}`,
    );
  }

  const m = result.metrics;
  const wrote =
    m.issuesCreated + m.issuesUpdated + m.issuesClosed > 0 ||
    m.discussionsPosted > 0 ||
    m.projectItemsRemoved > 0;
  if (wrote) {
    out.push(
      `  Wrote: ${m.issuesCreated} created, ${m.issuesUpdated} updated, ${m.issuesClosed} closed, ${m.issuesNoop} unchanged · ` +
        `${m.subIssuesLinked} links · ${m.projectItems} board items (${m.projectItemsRemoved} removed) · ${m.discussionsPosted} discussions`,
    );
  }

  out.push(`  Turns: ${result.numTurns}   Cost: $${result.costUsd.toFixed(4)}`);
  for (const [model, u] of Object.entries(result.modelUsage)) {
    out.push(`    ${model}: ${u.inputTokens}→${u.outputTokens} tok  $${u.costUsd.toFixed(4)}`);
  }
  if (result.errors.length) {
    out.push("  Errors:");
    for (const e of result.errors) out.push(`    - ${e}`);
  }

  process.stdout.write(`${out.join("\n")}\n`);
}
