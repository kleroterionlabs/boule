// src/cli/commands/requirements.ts — derive Requirement sub-issues from a Design issue.
import type { Command } from "commander";
import { globals, runWorkflow } from "./_shared.js";

export function registerRequirements(program: Command): void {
  program
    .command("requirements <design>")
    .description("Derive Requirement sub-issues (ISO/IEC/IEEE 29148 + Given/When/Then) from a Design issue.")
    .action(async (design: string, _local: unknown, cmd: Command) => {
      const prompt = [
        `Generate the requirements for Design issue "${design}".`,
        "Delegate to the requirements-engineer agent: produce functional and non-functional",
        "requirements with numeric NFRs and Given/When/Then acceptance criteria, each traceable",
        "back to the design. Have the critic-reviewer check each for unambiguity and verifiability,",
        "then the issue-project-manager upserts every requirement as a Requirement sub-issue under",
        "the Design (idempotent on boule-id).",
      ].join("\n");
      await runWorkflow(globals(cmd), "requirements", prompt);
    });
}
