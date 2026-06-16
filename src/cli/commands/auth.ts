// src/cli/commands/auth.ts — show which credentials Boule will use. Static, no network, no secrets
// printed (run `boule doctor` for a live auth probe).
import type { Command } from "commander";
import { resolveAuth } from "../../config/auth.js";
import { globals } from "./_shared.js";

export function registerAuth(program: Command): void {
  program
    .command("auth")
    .description("Show which credentials Boule will use (no secrets printed; use `doctor` to probe).")
    .action((_local: unknown, cmd: Command) => {
      const { json } = globals(cmd);

      const claude = process.env.CLAUDE_CODE_OAUTH_TOKEN
        ? "CLAUDE_CODE_OAUTH_TOKEN (Claude Code OAuth)"
        : process.env.ANTHROPIC_API_KEY
          ? "ANTHROPIC_API_KEY (metered)"
          : "claude login session (subscription)";

      let github: { source: string; detail: string };
      let error: string | undefined;
      try {
        const auth = resolveAuth(process.env);
        github =
          auth.github.kind === "app"
            ? {
                source: "GitHub App",
                detail: `app ${auth.github.appId}, installation ${auth.github.installationId}`,
              }
            : { source: "GITHUB_TOKEN", detail: "personal/installation token" };
      } catch (e) {
        github = { source: "(none)", detail: "" };
        error = e instanceof Error ? e.message : String(e);
      }

      if (json) {
        process.stdout.write(`${JSON.stringify({ claude, github, error })}\n`);
        if (error) process.exitCode = 3;
        return;
      }

      const out = [
        "\nCredentials Boule will use:",
        `  Claude:  ${claude}`,
        `  GitHub:  ${github.source}${github.detail ? ` — ${github.detail}` : ""}`,
      ];
      if (error) {
        out.push(`  ✗ ${error}`);
        process.exitCode = 3;
      }
      out.push("\nRun `boule doctor` to live-probe these credentials.");
      process.stdout.write(`${out.join("\n")}\n`);
    });
}
