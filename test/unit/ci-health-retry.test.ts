import { describe, expect, it, vi } from "vitest";
import { backoffDelay, isRateLimitError, withRetry } from "../../src/ci-health/retry.js";
import { CiHealthRateLimitError } from "../../src/ci-health/types.js";

/** An Octokit `RequestError`-shaped value carrying an HTTP status. */
function httpError(status: number): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

/** A no-op sleep that records the delays it was asked to wait, dodging real timers. */
function recordingSleep(): { sleep: (ms: number) => Promise<void>; delays: number[] } {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
  };
}

describe("backoffDelay", () => {
  it("produces capped exponential delays [1000, 2000, 4000, 8000, 16000]", () => {
    expect([0, 1, 2, 3, 4].map(backoffDelay)).toEqual([1000, 2000, 4000, 8000, 16000]);
  });

  it("caps the delay at 16000ms for higher attempts", () => {
    expect(backoffDelay(5)).toBe(16000);
    expect(backoffDelay(10)).toBe(16000);
  });
});

describe("isRateLimitError", () => {
  it("retries on HTTP 429", () => {
    expect(isRateLimitError(httpError(429))).toBe(true);
  });

  it("does not retry on 401 or 403", () => {
    expect(isRateLimitError(httpError(401))).toBe(false);
    expect(isRateLimitError(httpError(403))).toBe(false);
  });

  it("does not retry on non-429 statuses or non-HTTP errors", () => {
    expect(isRateLimitError(httpError(503))).toBe(false);
    expect(isRateLimitError(new Error("boom"))).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns the result after delays of 1s, 2s, 4s when the first 3 calls 429 then succeed", async () => {
    vi.useFakeTimers();
    try {
      const { sleep, delays } = recordingSleep();
      let calls = 0;
      const fn = vi.fn(async () => {
        calls += 1;
        if (calls <= 3) throw httpError(429);
        return "ok";
      });

      const result = await withRetry(fn, { sleep });

      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(4);
      expect(delays).toEqual([1000, 2000, 4000]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws CiHealthRateLimitError after the 5th retry given 6 consecutive 429s", async () => {
    vi.useFakeTimers();
    try {
      const { sleep, delays } = recordingSleep();
      const fn = vi.fn(async () => {
        throw httpError(429);
      });

      await expect(withRetry(fn, { sleep })).rejects.toBeInstanceOf(CiHealthRateLimitError);
      // 1 initial attempt + 5 retries = 6 calls; only the first 5 are followed by a sleep.
      expect(fn).toHaveBeenCalledTimes(6);
      expect(delays).toEqual([1000, 2000, 4000, 8000, 16000]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("chains the underlying error and attempt count on the thrown CiHealthRateLimitError", async () => {
    const { sleep } = recordingSleep();
    const underlying = httpError(429);
    const fn = vi.fn(async () => {
      throw underlying;
    });

    await expect(withRetry(fn, { sleep })).rejects.toMatchObject({
      name: "CiHealthRateLimitError",
      attempts: 6,
      cause: underlying,
    });
  });

  it("does not retry on 401 or 403, rethrowing the original error", async () => {
    const { sleep, delays } = recordingSleep();

    for (const status of [401, 403]) {
      const err = httpError(status);
      const fn = vi.fn(async () => {
        throw err;
      });
      await expect(withRetry(fn, { sleep })).rejects.toBe(err);
      expect(fn).toHaveBeenCalledTimes(1);
    }
    expect(delays).toEqual([]);
  });

  it("returns immediately without sleeping when the call succeeds first time", async () => {
    const { sleep, delays } = recordingSleep();
    const fn = vi.fn(async () => 42);

    expect(await withRetry(fn, { sleep })).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it("honours a custom maxRetries", async () => {
    const { sleep, delays } = recordingSleep();
    const fn = vi.fn(async () => {
      throw httpError(429);
    });

    await expect(withRetry(fn, { sleep, maxRetries: 2 })).rejects.toBeInstanceOf(CiHealthRateLimitError);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([1000, 2000]);
  });
});
