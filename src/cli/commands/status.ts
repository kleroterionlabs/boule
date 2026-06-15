// src/cli/commands/status.ts — read-only board summary.
import type { Command } from "commander";
import { globals, runWorkflow } from "./_shared.js";

export function registerStatus(program: Command): void {
  program
    .command("status")
    .alias("board")
    .description("Summarize the current board: counts by status/kind, in-flight work, blockers.")
    .action(async (_local: unknown, cmd: Command) => {
      const prompt = [
        "Read-only: summarize the Projects v2 board and open boule issues — counts by Status and",
        "Kind, in-flight items, blockers, and recently completed work. Do NOT create or modify",
        "anything; this is a reporting command.",
      ].join("\n");
      await runWorkflow(globals(cmd), "status", prompt);
    });
}
