// src/cli/commands/bootstrap.ts — provision labels, issue types, Project fields & Discussion categories.
import type { Command } from "commander";
import { ulid } from "ulid";
import { resolveAuth } from "../../config/auth.js";
import { type CliFlags, loadConfig } from "../../config/load.js";
import { bootstrap } from "../../github/bootstrap.js";
import { createGitHubClient } from "../../github/client.js";
import { createLogger } from "../../observability/logger.js";

export function registerBootstrap(program: Command): void {
  program
    .command("bootstrap")
    .description(
      "Create labels, issue types, Project fields & Discussion categories in the target repo (idempotent).",
    )
    .action(async (_local: unknown, cmd: Command) => {
      const global = cmd.optsWithGlobals() as CliFlags & { json?: boolean };
      const cfg = loadConfig({ cwd: process.cwd(), env: process.env, cli: global });
      const log = createLogger(cfg, ulid());
      const auth = resolveAuth(process.env);
      const gh = await createGitHubClient(auth, log);

      const report = await bootstrap(gh, cfg, log, { dryRun: cfg.flags.dryRun });
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

      if (report.manualActions.length) {
        process.stdout.write("\nManual steps still required (GitHub API limitations):\n");
        for (const action of report.manualActions) process.stdout.write(`  - ${action}\n`);
      }
    });
}
