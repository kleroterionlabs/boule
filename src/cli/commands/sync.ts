// src/cli/commands/sync.ts — reconcile issues with the Projects v2 board.
import type { Command } from "commander";
import { globals, runWorkflow } from "./_shared.js";

export function registerSync(program: Command): void {
  program
    .command("sync")
    .description("Reconcile issues ↔ board: add missing items, refresh field values, repair sub-issue links.")
    .action(async (_local: unknown, cmd: Command) => {
      const prompt = [
        "Reconcile every boule-managed issue with the Projects v2 board: ensure each artifact issue",
        "is an item on the board, that its field values match the issue's current state, and that",
        "sub-issue links are intact. Report a diff of what was changed. Idempotent — make no change",
        "that isn't required.",
      ].join("\n");
      await runWorkflow(globals(cmd), "sync", prompt);
    });
}
