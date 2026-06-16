// src/index.ts — programmatic API for CI/embedding (mirrors the CLI but typed).
export { buildProgram } from "./cli/index.js";
export { orchestrate, type OrchestrateArgs } from "./orchestrator/orchestrate.js";
export { loadConfig, type CliFlags } from "./config/load.js";
export { ConfigSchema, type Config } from "./config/schema.js";
export { resolveAuth, type AuthConfig } from "./config/auth.js";
export { runPipeline, type Stage, type RunContext } from "./workflows/pipeline.js";
export { createGitHubClient, type GitHubClient } from "./github/client.js";
export { buildRepoContext, type RepoContext } from "./github/resolve.js";
export { upsertIssue, findByBouleId, type IssueSpec } from "./github/issues.js";
export { bootstrap, type BootstrapReport } from "./github/bootstrap.js";
export * from "./core/types.js";
export {
  bouleId,
  contentHash,
  withBouleBlock,
  parseBouleBlock,
} from "./util/idempotency.js";
