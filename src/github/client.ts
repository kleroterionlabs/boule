// src/github/client.ts — THE only path to the GitHub API. All backoff/concurrency/budget tracking
// now live in @kleroterion/koine (the concurrency-capped, budget-tracking client originated here and
// was upstreamed verbatim). This re-export shim preserves the "./client.js" import path for callers.
export {
  createGitHubClient,
  type GitHubClient,
  type BudgetSnapshot,
  type ClientOptions,
} from "@kleroterion/koine";
