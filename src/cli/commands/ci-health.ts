// src/cli/commands/ci-health.ts — report org-wide CI health (flaky/failing workflows) as a table or JSON.
import type { Command } from "commander";
import type { WorkflowRun } from "../../ci-health/types.js";
import { globals } from "./_shared.js";

/** Local options parsed off the `ci-health` subcommand (the global `--json` lives on the root program). */
export interface CiHealthOptions {
  /** Bypass any cached Actions data and re-fetch from GitHub. */
  noCache: boolean;
  /** ISO-8601 lower bound for runs to consider; defaults to 24h before now. */
  since: string;
  /** Skip the per-commit verification pass when classifying flakiness. */
  skipCommitCheck: boolean;
}

/** A single row of the CI-health summary: one workflow's recent health. */
export interface CiHealthRow {
  /** `owner/repo` the workflow belongs to. */
  repo: string;
  /** Workflow (run) display name. */
  workflow: string;
  /** How many runs were considered in the window. */
  runs: number;
  /** How many of those runs failed. */
  failures: number;
  /** Classification verdict, e.g. `healthy` | `flaky` | `failing`. */
  verdict: string;
}

/** The aggregate CI-health summary rendered to the user. */
export interface CiHealthSummary {
  /** ISO-8601 window start the summary was computed over. */
  since: string;
  /** Per-workflow rows. */
  rows: CiHealthRow[];
}

/**
 * Pipeline seams the handler drives in sequence. Defaults compose the real
 * GitHub-backed implementations; tests inject mocks to exercise the command
 * offline. Sibling tasks fill in the real fetch/classify/summarise logic.
 */
export interface CiHealthDeps {
  fetchAllWorkflowRuns(opts: CiHealthOptions & { json: boolean }): Promise<WorkflowRun[]>;
  classifyFlakiness(runs: WorkflowRun[]): WorkflowRun[];
  buildSummary(runs: WorkflowRun[], opts: CiHealthOptions): CiHealthSummary;
}

/** Default pipeline: a valid empty summary until the data-layer tasks land. */
const defaultDeps: CiHealthDeps = {
  async fetchAllWorkflowRuns() {
    return [];
  },
  classifyFlakiness(runs) {
    return runs;
  },
  buildSummary(_runs, opts) {
    return { since: opts.since, rows: [] };
  },
};

/** Render the summary as a fixed-width table to stdout. */
export function renderTable(summary: CiHealthSummary): void {
  const out: string[] = [`\nCI health since ${summary.since}:`];
  if (summary.rows.length === 0) {
    out.push("  No workflow runs in the selected window.");
  } else {
    out.push("  REPO                          WORKFLOW              RUNS  FAIL  VERDICT");
    for (const r of summary.rows) {
      out.push(
        `  ${r.repo.padEnd(30)}${r.workflow.padEnd(22)}${String(r.runs).padStart(4)}  ${String(
          r.failures,
        ).padStart(4)}  ${r.verdict}`,
      );
    }
  }
  process.stdout.write(`${out.join("\n")}\n`);
}

/** Render the summary as a single line of JSON to stdout. */
export function renderJson(summary: CiHealthSummary): void {
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

/** ISO-8601 timestamp for 24 hours before now (the default `--since` lower bound). */
function defaultSince(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Register the `ci-health` command. The handler drives the pipeline in order —
 * fetch → classify → summarise — then dispatches to the table or JSON renderer.
 * `deps` defaults to the real pipeline; tests pass mocks.
 */
export function registerCiHealth(program: Command, deps: CiHealthDeps = defaultDeps): void {
  program
    .command("ci-health")
    .alias("cih")
    .description("Report org-wide CI health: flaky and failing workflows over a recent window.")
    .option("--no-cache", "bypass cached Actions data and re-fetch from GitHub", false)
    .option("--since <iso>", "ISO-8601 lower bound for runs to consider", defaultSince())
    .option("--skip-commit-check", "skip the per-commit verification pass when classifying", false)
    .action(async (local: { cache: boolean; since: string; skipCommitCheck: boolean }, cmd: Command) => {
      const { json } = globals(cmd);
      // Commander stores `--no-cache` under the inverted `cache` key (true unless --no-cache given).
      const opts: CiHealthOptions = {
        noCache: local.cache === false,
        since: local.since,
        skipCommitCheck: Boolean(local.skipCommitCheck),
      };
      try {
        const runs = await deps.fetchAllWorkflowRuns({ ...opts, json: Boolean(json) });
        const classified = deps.classifyFlakiness(runs);
        const summary = deps.buildSummary(classified, opts);
        if (json) renderJson(summary);
        else renderTable(summary);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`boule ci-health: ${msg}\n`);
        process.exit(1);
      }
    });
}
