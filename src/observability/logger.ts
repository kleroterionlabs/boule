// src/observability/logger.ts — structured JSON logs. The pino logger is built in @kleroterion/koine;
// this adapter keeps Boule's existing createLogger(cfg, runId) signature and call sites unchanged,
// delegating to koine and tagging the service as "boule".
import { type Logger, createLogger as koineLogger } from "@kleroterion/koine";
import type { Config } from "../config/schema.js";

export type { Logger };

export function createLogger(cfg: Config, runId: string): Logger {
  return koineLogger({ level: cfg.log.level, service: "boule", runId });
}
