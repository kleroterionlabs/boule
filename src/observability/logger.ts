// src/observability/logger.ts — structured JSON logs (pretty on TTY); redacts secrets on egress.
import pino, { type Logger as PinoLogger } from "pino";
import type { Config } from "../config/schema.js";

export type Logger = PinoLogger;

export function createLogger(cfg: Config, runId: string): Logger {
  return pino({
    level: cfg.log.level,
    base: { runId, service: "boule" },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        "*.token",
        "*.apiKey",
        "*.privateKey",
        "headers.authorization",
        "CLAUDE_CODE_OAUTH_TOKEN",
        "ANTHROPIC_API_KEY",
        "GITHUB_TOKEN",
        "BOULE_APP_PRIVATE_KEY",
      ],
      censor: "[REDACTED]",
    },
    ...(cfg.log.pretty ? { transport: { target: "pino-pretty" } } : {}),
  });
}
