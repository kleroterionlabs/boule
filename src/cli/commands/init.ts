import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
// src/cli/commands/init.ts — scaffold a .boule/config.yaml in the current directory.
import type { Command } from "commander";

function configTemplate(repo: string): string {
  return [
    "version: 1",
    "# Target repository (owner/repo) and optional Projects v2 number.",
    `repo: ${repo}`,
    "# projectNumber: 1",
    "primaryRanker: rice",
    "",
    "models:",
    "  orchestrator: claude-opus-4-8 # coordinator (its turns dominate cost; sonnet ≈ 40-50% cheaper)",
    "  default: claude-opus-4-8      # hard-reasoning tier",
    "  subagent: claude-sonnet-4-6   # specialists",
    "  fast: claude-haiku-4-5        # read-only context scouting",
    "  effort: xhigh",
    "",
    "budgets:",
    "  usdPerRun: 5",
    "  maxTurns: 80",
    "  maxGithubWrites: 300",
    "",
    "flags:",
    "  dryRun: false",
    "  postDailyStatus: true",
    "",
  ].join("\n");
}

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Create a .boule/config.yaml in the current directory.")
    .option("--force", "overwrite an existing config", false)
    .action((local: { force?: boolean }, cmd: Command) => {
      const global = cmd.optsWithGlobals() as { repo?: string };
      const dir = resolve(process.cwd(), ".boule");
      const file = resolve(dir, "config.yaml");
      if (existsSync(file) && !local.force) {
        process.stderr.write("boule: .boule/config.yaml already exists (use --force to overwrite)\n");
        process.exitCode = 1;
        return;
      }
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, configTemplate(global.repo ?? "owner/repo"), "utf8");
      process.stdout.write(
        `Wrote ${file}\nNext: set CLAUDE_CODE_OAUTH_TOKEN (\`claude setup-token\`) or ANTHROPIC_API_KEY, plus GITHUB_TOKEN, then run \`boule doctor\` and \`boule bootstrap\`.\n`,
      );
    });
}
