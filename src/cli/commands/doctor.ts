// src/cli/commands/doctor.ts — preflight: validate environment, credentials, and config,
// then (unless --offline) mint a real GitHub token and confirm the API answers.
import type { Command } from "commander";
import { resolveAuth } from "../../config/auth.js";
import { type CliFlags, loadConfig } from "../../config/load.js";
import { probeGitHub } from "../../github/probe.js";

type Check = { name: string; ok: boolean; hint: string };

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("Validate environment, credentials, and config; live-probe GitHub auth.")
    .option("--offline", "skip the live GitHub auth probe (static checks only)", false)
    .action(async (local: { offline?: boolean }, cmd: Command) => {
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

      // Live probe: mint a real token and hit the API. Only when creds resolve and not --offline.
      let probeFailed = false;
      if (local.offline) {
        process.stdout.write("\n(skipped live GitHub probe: --offline)\n");
      } else if (ghCreds && authError === "") {
        const auth = resolveAuth(process.env);
        process.stdout.write(
          `\nProbing GitHub (${auth.github.kind === "app" ? "minting an installation token" : "checking the token"})…\n`,
        );
        const probe = await probeGitHub(auth);
        if (!probe.ok) {
          probeFailed = true;
          process.stdout.write(`✗ GitHub auth probe failed: ${probe.error}\n`);
        } else if (probe.mode === "app") {
          const who = probe.identity ? ` for @${probe.identity}` : "";
          process.stdout.write(`✓ installation token minted${who} — ${probe.repoCount} repo(s) accessible\n`);
          const repos = probe.repos ?? [];
          for (const r of repos.slice(0, 20)) process.stdout.write(`    ${r}\n`);
          if (repos.length > 20) process.stdout.write(`    … and ${repos.length - 20} more\n`);
        } else {
          process.stdout.write(`✓ token authenticates (${probe.rateRemaining} REST requests remaining)\n`);
        }
      }

      if (!allOk || probeFailed) process.exitCode = 3;
    });
}
