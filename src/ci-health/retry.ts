// src/ci-health/retry.ts — exponential-backoff retry for rate-limited (HTTP 429) calls.
// Wraps a thunk and retries it with capped exponential delays whenever GitHub responds
// with 429, surfacing a typed CiHealthRateLimitError once the retry budget is spent.

import { CiHealthRateLimitError } from "./types.js";

/** HTTP statuses that must never be retried regardless of {@link RetryOptions.shouldRetry}. */
const doNotRetry: ReadonlySet<number> = new Set([401, 403]);

/** Default number of retry attempts after the initial call. */
const DEFAULT_MAX_RETRIES = 5;

/** Upper bound on a single backoff delay, in milliseconds. */
const MAX_DELAY_MS = 16_000;

/** Options controlling {@link withRetry}'s backoff behaviour. */
export interface RetryOptions {
  /** Maximum number of retries after the initial attempt. Defaults to {@link DEFAULT_MAX_RETRIES}. */
  maxRetries?: number;
  /** Predicate deciding whether an error is retryable. Defaults to {@link isRateLimitError}. */
  shouldRetry?: (err: unknown) => boolean;
  /** Injectable sleep helper, primarily for tests. Defaults to a real `setTimeout`-backed sleep. */
  sleep?: (ms: number) => Promise<void>;
}

/** Real sleep helper used in production; replaceable in tests via {@link RetryOptions.sleep}. */
const defaultSleep = async (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Extract the HTTP status from an Octokit `RequestError`-shaped value, if present. */
function httpStatusOf(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error) {
    const { status } = error as { status: unknown };
    if (typeof status === "number") return status;
  }
  return undefined;
}

/**
 * Default retry predicate: retry on HTTP 429 (and Octokit `RequestError` with status
 * 429), but never on the {@link doNotRetry} statuses (401/403).
 */
export function isRateLimitError(err: unknown): boolean {
  const status = httpStatusOf(err);
  if (status === undefined) return false;
  if (doNotRetry.has(status)) return false;
  return status === 429;
}

/** Capped exponential backoff: `min(1000 * 2^attempt, 16000)` ms (attempt is 0-based). */
export function backoffDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, MAX_DELAY_MS);
}

/**
 * Run `fn`, retrying with capped exponential backoff while {@link RetryOptions.shouldRetry}
 * deems the thrown error retryable.
 *
 * Delays follow `[1000, 2000, 4000, 8000, 16000]` ms for the default five retries. Once the
 * retry budget is exhausted a {@link CiHealthRateLimitError} is thrown, chaining the last
 * underlying error as its `cause`.
 */
export async function withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T> {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const shouldRetry = options?.shouldRetry ?? isRateLimitError;
  const sleep = options?.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries || !shouldRetry(error)) {
        if (!shouldRetry(error)) throw error;
        break;
      }
      await sleep(backoffDelay(attempt));
    }
  }

  throw new CiHealthRateLimitError(
    `Rate limited by GitHub (HTTP 429); exhausted ${maxRetries} retries`,
    maxRetries + 1,
    { cause: lastError },
  );
}
