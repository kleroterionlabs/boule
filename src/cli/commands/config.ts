// src/cli/commands/config.ts — show the resolved effective config (file + env + flags merged).
import type { Command } from "commander";
import { type CliFlags, loadConfig } from "../../config/load.js";
import { globals } from "./_shared.js";

export function registerConfig(program: Command): void {
  program
    .command("config")
    .description("Print the resolved effective configuration (file + env + CLI flags merged).")
    .action((_local: unknown, cmd: Command) => {
      const global = globals(cmd);
      let cfg: ReturnType<typeof loadConfig>;
      try {
        cfg = loadConfig({ cwd: process.cwd(), env: process.env, cli: global as CliFlags });
      } catch (e) {
        process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
        process.exitCode = 3;
        return;
      }

      if (global.json) {
        process.stdout.write(`${JSON.stringify(cfg, null, 2)}\n`);
        return;
      }

      const out: string[] = ["\nResolved configuration:"];
      out.push(`  repo:            ${cfg.repo}`);
      out.push(`  project:         ${cfg.projectNumber ?? "(none)"}`);
      out.push(`  primary ranker:  ${cfg.primaryRanker}`);
      out.push(`  models:          orchestrator=${cfg.models.orchestrator}  subagent=${cfg.models.subagent}`);
      out.push(
        `  budget:          $${cfg.budgets.usdPerRun}/run  ${cfg.budgets.maxTurns} turns  ${cfg.budgets.maxGithubWrites} writes`,
      );
      out.push(
        `  discussions:     daily="${cfg.discussions.dailyCategory}"  handoffs="${cfg.discussions.handoffCategory}"`,
      );
      out.push(`  flags:           dryRun=${cfg.flags.dryRun}  postDailyStatus=${cfg.flags.postDailyStatus}`);
      out.push(`  log level:       ${cfg.log.level}`);
      process.stdout.write(`${out.join("\n")}\n`);
    });
}
