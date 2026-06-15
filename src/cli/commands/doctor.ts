// src/cli/commands/doctor.ts — preflight: validate environment, credentials, and config.
import type { Command } from "commander";
import { resolveAuth } from "../../config/auth.js";
import { type CliFlags, loadConfig } from "../../config/load.js";

type Check = { name: string; ok: boolean; hint: string };

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("Validate environment, credentials, and config before a run.")
    .action((_local: unknown, cmd: Command) => {
      const global = cmd.optsWithGlobals() as CliFlags;
      const checks: Check[] = [];

      checks.push({
        name: "Claude auth present (CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY)",
        ok: Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY),
        hint: "run `claude setup-token` and set CLAUDE_CODE_OAUTH_TOKEN (or set ANTHROPIC_API_KEY)",
      });

      const ghCreds =
        Boolean(process.env.GITHUB_TOKEN) ||
        Boolean(
          process.env.BOULE_APP_ID &&
            process.env.BOULE_APP_INSTALLATION_ID &&
            process.env.BOULE_APP_PRIVATE_KEY,
        );
      checks.push({
        name: "GitHub credentials present",
        ok: ghCreds,
        hint: "set GITHUB_TOKEN, or the BOULE_APP_* trio",
      });

      let cfgError = "";
      try {
        loadConfig({ cwd: process.cwd(), env: process.env, cli: global });
      } catch (e) {
        cfgError = e instanceof Error ? e.message : String(e);
      }
      checks.push({
        name: "config valid",
        ok: cfgError === "",
        hint: cfgError || "fix .boule/config.yaml or pass --repo",
      });

      let authError = "";
      try {
        resolveAuth(process.env);
      } catch (e) {
        authError = e instanceof Error ? e.message : String(e);
      }
      checks.push({ name: "auth resolves", ok: authError === "", hint: authError || "provide credentials" });

      let allOk = true;
      for (const c of checks) {
        process.stdout.write(`${c.ok ? "✓" : "✗"} ${c.name}${c.ok ? "" : `  → ${c.hint}`}\n`);
        if (!c.ok) allOk = false;
      }
      if (!allOk) process.exitCode = 3;
    });
}
