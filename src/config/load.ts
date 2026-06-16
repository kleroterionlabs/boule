// src/config/load.ts — pure four-layer merge, secrets resolved separately in auth.ts.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { ConfigError } from "../util/errors.js";
import { type Config, ConfigSchema } from "./schema.js";

export interface CliFlags {
  repo?: string;
  project?: number;
  model?: string;
  effort?: string;
  budget?: number;
  maxTurns?: number;
  dryRun?: boolean;
  logLevel?: string;
  config?: string;
}

function readConfigFile(cwd: string, override?: string): Record<string, unknown> {
  const path = override ? resolve(cwd, override) : resolve(cwd, ".boule/config.yaml");
  if (!existsSync(path)) return {};
  try {
    return (parseYaml(readFileSync(path, "utf8")) as Record<string, unknown>) ?? {};
  } catch (e) {
    throw new ConfigError(`failed to parse ${path}: ${String(e)}`);
  }
}

function mapEnv(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (env.BOULE_REPO) out.repo = env.BOULE_REPO;
  if (env.BOULE_PROJECT) out.projectNumber = Number(env.BOULE_PROJECT);
  if (env.BOULE_BUDGET_USD) out.budgets = { usdPerRun: Number(env.BOULE_BUDGET_USD) };
  if (env.BOULE_LOG_LEVEL) out.log = { level: env.BOULE_LOG_LEVEL };
  if (env.BOULE_DRY_RUN) out.flags = { dryRun: env.BOULE_DRY_RUN === "1" };
  return out;
}

function mapCli(cli: CliFlags): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (cli.repo) out.repo = cli.repo;
  if (cli.project !== undefined) out.projectNumber = cli.project;
  if (cli.model || cli.effort) {
    out.models = {
      ...(cli.model && { default: cli.model, orchestrator: cli.model }),
      ...(cli.effort && { effort: cli.effort }),
    };
  }
  if (cli.budget !== undefined || cli.maxTurns !== undefined) {
    out.budgets = {
      ...(cli.budget !== undefined && { usdPerRun: cli.budget }),
      ...(cli.maxTurns !== undefined && { maxTurns: cli.maxTurns }),
    };
  }
  if (cli.dryRun !== undefined) out.flags = { dryRun: cli.dryRun };
  if (cli.logLevel) out.log = { level: cli.logLevel };
  return out;
}

/** Shallow-by-section deep merge (right wins); each top-level object section merged. */
function deepMerge(...layers: Record<string, unknown>[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const layer of layers) {
    for (const [k, v] of Object.entries(layer)) {
      if (v && typeof v === "object" && !Array.isArray(v) && typeof out[k] === "object") {
        out[k] = { ...(out[k] as object), ...(v as object) };
      } else {
        out[k] = v;
      }
    }
  }
  return out;
}

export function loadConfig(args: { cwd: string; env: NodeJS.ProcessEnv; cli: CliFlags }): Config {
  const merged = deepMerge(readConfigFile(args.cwd, args.cli.config), mapEnv(args.env), mapCli(args.cli));
  const parsed = ConfigSchema.safeParse(merged);
  if (!parsed.success) {
    throw new ConfigError(`invalid config:\n${JSON.stringify(parsed.error.flatten(), null, 2)}`);
  }
  return parsed.data;
}
