// src/cli/commands/daily.ts — post the daily status standup as a GitHub Discussion (the "dashboard").
import type { Command } from "commander";
import { globals, runWorkflow } from "./_shared.js";

export function registerDaily(program: Command): void {
  program
    .command("daily")
    .description(
      "Post today's status standup to the 'Daily Status' Discussion category (the Boule dashboard).",
    )
    .action(async (_local: unknown, cmd: Command) => {
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const prompt = [
        `Today is ${today}. Compose and post today's daily status to the 'Daily Status' Discussion`,
        "category: yesterday's completed work, today's in-flight items, blockers, board metrics, and",
        "notable agent activity. Use the issue-project-manager to post it via gh_post_discussion with",
        `key="status:${today}" so re-running today edits the same post instead of creating a duplicate.`,
        `Title it "Daily Status — ${today}".`,
      ].join("\n");
      await runWorkflow(globals(cmd), "daily", prompt);
    });
}
