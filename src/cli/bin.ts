#!/usr/bin/env node
// src/cli/bin.ts — the bin target; keeps process wiring out of the testable program builder.
import { buildProgram, exitCodeFor } from "./index.js";

async function main(): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    process.exitCode = exitCodeFor(err);
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`boule: ${msg}\n`);
  }
}

void main();
