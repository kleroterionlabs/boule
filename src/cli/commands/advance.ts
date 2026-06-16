// src/cli/commands/advance.ts — autonomously push not-yet-accepted artifacts through the Critic gate
// and on into their next stage (intended for scheduled/CI runs, after triage).
import type { Command } from "commander";
import { globals, runWorkflow } from "./_shared.js";

export function registerAdvance(program: Command): void {
  program
    .command("advance")
    .description(
      "Drive not-yet-accepted artifacts through the Critic gate to accepted/Ready, then into their " +
        "next stage (accepted Design → Requirements). Fully autonomous; no human review.",
    )
    .option("--kind <kind>", "only advance artifacts of this kind (e.g. design, requirement)")
    .action(async (local: { kind?: string }, cmd: Command) => {
      const prompt = [
        "Advance the backlog autonomously — there is no human review gate; the Critic is the sole",
        "approval authority.",
        "1) Use gh_list_issues (managedOnly, state open) to find every boule-managed artifact that is NOT",
        "   yet accepted: it carries status:needs-review or status:draft, or its board Status is one of",
        "   Triage / In Design / In Review (i.e. not status:accepted / Ready).",
        local.kind ? `   Restrict to kind=${local.kind}.` : "",
        "2) For each, read its current body via gh_find_issue, then delegate the critic-reviewer to review",
        "   it against its acceptance bar.",
        "   - APPROVE → have the ipm set status:accepted + board Status:Ready, then schedule the next",
        "     stage: an accepted Design that has no Requirement sub-issues yet → delegate the",
        "     requirements-engineer to derive them, each critic-reviewed and accepted the same way.",
        "   - REJECT → have the producing specialist revise the existing body IN PLACE (UPDATE, idempotent",
        "     on boule-id) addressing the findings, then re-review; once it passes, accept it. If it still",
        "     cannot pass after the bounded rewrite loop, label it boule:needs-human and move on.",
        "Respect the budget/turn caps — stop cleanly rather than thrashing. Summarize per artifact:",
        "boule-id, old status → new status, and any sub-issues created.",
      ]
        .filter(Boolean)
        .join("\n");
      await runWorkflow(globals(cmd), "advance", prompt);
    });
}
