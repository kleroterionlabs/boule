// src/cli/commands/advance.ts — autonomously push not-yet-accepted artifacts through the Critic gate
// and on into their next stage (intended for scheduled/CI runs, after triage).
import type { Command } from "commander";
import { globals, runWorkflow } from "./_shared.js";

export function registerAdvance(program: Command): void {
  program
    .command("advance")
    .description(
      "Drive not-yet-accepted artifacts through the Critic gate to accepted/Ready, then into their " +
        "next stage (Design → Requirements → Epic/Feature/Task plan). Fully autonomous; no human review.",
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
        "   - APPROVE → have the ipm accept it. For an EXISTING issue this MUST go through gh_set_status",
        "     (status=accepted) — gh_upsert_issue does NOT change labels on update, so the design would",
        "     otherwise stay stuck at needs-review.",
        "   - REJECT → have the producing specialist revise the existing body IN PLACE (UPDATE, idempotent",
        "     on boule-id) addressing the findings, then re-review; once it passes, accept it. If it still",
        "     cannot pass after the bounded rewrite loop, label it boule:needs-human and move on.",
        "3) Then flow each accepted artifact to its NEXT stage (eager — do not wait for a separate command):",
        "   - accepted Design with no Requirement sub-issues yet → requirements-engineer derives them (each",
        "     critic-reviewed + accepted); wire Blocked-by ordering via gh_add_dependency; the set must",
        "     cover every job story.",
        "   - Design whose requirement set is complete + accepted but has NO Epic/Feature/Task tree yet →",
        "     decompose it into the work breakdown (Epic → Feature → Task), each Task linking",
        "     Verifies: #<REQ>, each critic-reviewed + accepted, added to the board with Kind/Priority/RICE/",
        "     Status set and prerequisite ordering wired via gh_add_dependency.",
        "Respect the budget/turn caps — decomposition is the costliest stage, so if the cap is near finish",
        "the current subtree cleanly and resume next run (idempotent). Summarize per artifact: boule-id,",
        "old status → new status, and any sub-issues created.",
      ]
        .filter(Boolean)
        .join("\n");
      await runWorkflow(globals(cmd), "advance", prompt);
    });
}
