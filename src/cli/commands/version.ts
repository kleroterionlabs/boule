// src/cli/commands/version.ts — print the Boule version.
import type { Command } from "commander";
import { getVersion } from "../../util/version.js";
import { globals } from "./_shared.js";

export function registerVersion(program: Command): void {
  program
    .command("version")
    .description("Print the Boule version.")
    .action((_local: unknown, cmd: Command) => {
      const { json } = globals(cmd);
      if (json) process.stdout.write(`${JSON.stringify({ version: getVersion() })}\n`);
      else process.stdout.write(`boule ${getVersion()}\n`);
    });
}
