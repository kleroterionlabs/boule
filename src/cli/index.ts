// src/cli/index.ts — thin adapter: parse argv → build a workflow request → call a command handler.
import { Command } from "commander";
import { getVersion } from "../util/version.js";
import { registerAdvance } from "./commands/advance.js";
import { registerAuth } from "./commands/auth.js";
import { registerBootstrap } from "./commands/bootstrap.js";
import { registerCiHealth } from "./commands/ci-health.js";
import { registerCompete } from "./commands/compete.js";
import { registerConfig } from "./commands/config.js";
import { registerDaily } from "./commands/daily.js";
import { registerDesign } from "./commands/design.js";
import { registerDoctor } from "./commands/doctor.js";
import { registerGap } from "./commands/gap.js";
import { registerInit } from "./commands/init.js";
import { registerPlan } from "./commands/plan.js";
import { registerRefine } from "./commands/refine.js";
import { registerRequirements } from "./commands/requirements.js";
import { registerResolve } from "./commands/resolve.js";
import { registerResume } from "./commands/resume.js";
import { registerRuns } from "./commands/runs.js";
import { registerStatus } from "./commands/status.js";
import { registerSync } from "./commands/sync.js";
import { registerTriage } from "./commands/triage.js";
import { registerUndo } from "./commands/undo.js";
import { registerVersion } from "./commands/version.js";

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("boule")
    .description("Autonomous PM/program-manager/analyst on GitHub, powered by the Claude Agent SDK.")
    .version(getVersion())
    // global control flags (read by command handlers via program.optsWithGlobals())
    .option("--repo <owner/repo>", "target repository")
    .option("--project <number>", "target Projects v2 number", (v) => Number(v))
    .option("--model <id>", "orchestrator model")
    .option("--budget <usd>", "hard cost cap (USD)", (v) => Number(v))
    .option("--max-turns <n>", "max agentic turns", (v) => Number(v))
    .option("--dry-run", "plan only; deny all GitHub writes", false)
    .option("--json", "stream machine-readable NDJSON events (one JSON object per line)", false)
    .option("--config <path>", "config file path")
    .option("-v, --verbose", "verbose progress", false);

  for (const register of [
    registerInit,
    registerDoctor,
    registerBootstrap,
    registerDesign,
    registerRequirements,
    registerCompete,
    registerGap,
    registerPlan,
    registerRefine,
    registerSync,
    registerTriage,
    registerAdvance,
    registerStatus,
    registerDaily,
    registerCiHealth,
    registerUndo,
    registerResume,
    registerResolve,
    registerRuns,
    registerConfig,
    registerAuth,
    registerVersion,
  ]) {
    register(program);
  }
  return program;
}

/** Map a thrown error to a process exit code (see CLI UX §6.6). */
export function exitCodeFor(err: unknown): number {
  const name = (err as { name?: string })?.name ?? "";
  if (name === "ConfigError") return 3;
  if (name === "BudgetExceededError") return 4;
  if (name === "RateLimitError") return 5;
  return 1;
}
