// src/config/schema.ts — single validation layer for config file + env-mapped overrides.
import { z } from "zod";

export const ModelId = z.enum(["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"]);
export type ModelId = z.infer<typeof ModelId>;

export const EffortLevel = z.enum(["low", "medium", "high", "xhigh", "max"]);
export type EffortLevel = z.infer<typeof EffortLevel>;

export const ConfigSchema = z
  .object({
    version: z.literal(1).default(1),
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, "expected owner/repo"),
    org: z.string().optional(),
    projectNumber: z.number().int().positive().optional(),
    primaryRanker: z.enum(["rice", "wsjf"]).default("rice"),

    models: z
      .object({
        default: ModelId.default("claude-opus-4-8"),
        subagent: ModelId.default("claude-sonnet-4-6"),
        fast: ModelId.default("claude-haiku-4-5"),
        effort: EffortLevel.default("xhigh"),
      })
      .default({}),

    budgets: z
      .object({
        usdPerRun: z.number().positive().default(5),
        maxTurns: z.number().int().positive().default(80),
        maxGithubWrites: z.number().int().positive().default(300),
        graphqlPointBudget: z.number().int().positive().default(4000),
        fanoutConcurrency: z.number().int().positive().default(4),
      })
      .default({}),

    taxonomy: z
      .object({
        useIssueTypes: z.boolean().default(true),
      })
      .default({}),

    discussions: z
      .object({
        dailyCategory: z.string().default("Daily Status"),
        handoffCategory: z.string().default("Agent Handoffs"),
        designReviewCategory: z.string().default("Design Review"),
      })
      .default({}),

    flags: z
      .object({
        dryRun: z.boolean().default(false),
        postDailyStatus: z.boolean().default(true),
      })
      .default({}),

    log: z
      .object({
        level: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
        pretty: z.boolean().default(false),
      })
      .default({}),
  })
  .strict();

export type Config = z.infer<typeof ConfigSchema>;
