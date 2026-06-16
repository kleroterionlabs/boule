import { graphql as octokitGraphql } from "@octokit/graphql";
import { throttling } from "@octokit/plugin-throttling";
// src/github/client.ts — THE only path to the GitHub API. All backoff/concurrency/budget live here.
import { Octokit } from "@octokit/rest";
import pLimit, { type LimitFunction } from "p-limit";
import pRetry, { AbortError } from "p-retry";
import type { AuthConfig } from "../config/auth.js";
import type { Logger } from "../observability/logger.js";
import { mintToken } from "./auth.js";

const ThrottledOctokit = Octokit.plugin(throttling);

type OpKind = "read" | "write";
export interface BudgetSnapshot {
  limit: number;
  remaining: number;
  resetAt: number;
}

export interface GitHubClient {
  rest: Octokit;
  /** Run a REST call through the concurrency+retry gate. */
  withRest<T>(op: OpKind, fn: (o: Octokit) => Promise<T>): Promise<T>;
  /** Run a GraphQL document through the gate; piggybacks rateLimit{} budget tracking. */
  graphql<T = unknown>(op: OpKind, query: string, vars?: Record<string, unknown>): Promise<T>;
  budget(): { rest: BudgetSnapshot; graphql: BudgetSnapshot };
}

const jitter = (ms: number): number => ms * (0.5 + Math.random());
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function createGitHubClient(
  auth: AuthConfig,
  log: Logger,
  opts: { readConcurrency?: number; writeConcurrency?: number; maxRetries?: number } = {},
): Promise<GitHubClient> {
  const token = await mintToken(auth.github); // App installation token or PAT
  const rest = new ThrottledOctokit({
    auth: token,
    throttle: {
      onRateLimit: (after, o, _ok, retryCount) => {
        log.warn({ after, retryCount }, "primary rate limit");
        return retryCount < 3;
      },
      onSecondaryRateLimit: (after) => {
        log.warn({ after }, "secondary rate limit; honoring retry-after");
        return true;
      },
    },
  });
  const gql = octokitGraphql.defaults({
    headers: {
      authorization: `token ${token}`,
      // Opt into the issue-types + sub-issues GraphQL fields. Harmless once GA; required while
      // either is in preview (without it, addSubIssue / issueType fields are rejected as unknown).
      "GraphQL-Features": "issue_types,sub_issues",
    },
  });

  const limits: Record<OpKind, LimitFunction> = {
    read: pLimit(opts.readConcurrency ?? 8),
    write: pLimit(opts.writeConcurrency ?? 1), // serialize writes ⇒ stay under ~80/min cap
  };
  const budget = {
    rest: { limit: 5000, remaining: 5000, resetAt: 0 } as BudgetSnapshot,
    graphql: { limit: 5000, remaining: 5000, resetAt: 0 } as BudgetSnapshot,
  };

  function classifyWait(err: unknown, attempt: number): number {
    const e = err as { status?: number; response?: { status?: number; headers?: Record<string, string> } };
    const status = e.status ?? e.response?.status;
    const headers = e.response?.headers ?? {};
    if (status === 403 || status === 429) {
      const ra = Number(headers["retry-after"]);
      if (Number.isFinite(ra)) return ra * 1000;
      const reset = Number(headers["x-ratelimit-reset"]);
      if (Number.isFinite(reset)) return Math.max(0, reset * 1000 - Date.now());
      return Math.max(60_000, jitter(2 ** attempt * 1000));
    }
    if (status && status >= 500) return jitter(2 ** attempt * 500);
    throw new AbortError(err as Error); // 4xx (non-rate) ⇒ don't retry
  }

  const run = <T>(op: OpKind, task: () => Promise<T>): Promise<T> =>
    limits[op](() =>
      pRetry(
        async (attempt) => {
          try {
            return await task();
          } catch (err) {
            await sleep(classifyWait(err, attempt));
            throw err;
          }
        },
        { retries: opts.maxRetries ?? 6, minTimeout: 1000, factor: 2 },
      ),
    );

  return {
    rest,
    withRest: (op, fn) => run(op, () => fn(rest)),
    graphql: <T>(op: OpKind, query: string, vars?: Record<string, unknown>) =>
      run<T>(op, async () => {
        const withBudget = query.includes("rateLimit {")
          ? query
          : query.replace(/}\s*$/, "  rateLimit { limit remaining resetAt }\n}");
        const data = (await gql(withBudget, vars)) as T & {
          rateLimit?: { limit: number; remaining: number; resetAt: string };
        };
        if (data?.rateLimit) {
          budget.graphql.remaining = data.rateLimit.remaining;
          budget.graphql.limit = data.rateLimit.limit;
          budget.graphql.resetAt = Math.floor(new Date(data.rateLimit.resetAt).getTime() / 1000);
        }
        return data;
      }),
    budget: () => ({ rest: { ...budget.rest }, graphql: { ...budget.graphql } }),
  };
}
