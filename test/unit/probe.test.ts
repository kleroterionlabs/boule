import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import type { AuthConfig } from "../../src/config/auth.js";
import { probeGitHub } from "../../src/github/probe.js";
import { server } from "../setup.js";

const patAuth: AuthConfig = {
  claudeAuth: "subscription-login",
  github: { kind: "pat", token: "ghp_test" },
};

describe("probeGitHub (PAT mode)", () => {
  it("reports ok with the remaining rate when the token authenticates", async () => {
    server.use(
      http.get("https://api.github.com/rate_limit", () =>
        HttpResponse.json({
          resources: { core: { limit: 5000, remaining: 4999, reset: 0, used: 1 } },
          rate: { limit: 5000, remaining: 4999, reset: 0, used: 1 },
        }),
      ),
    );

    const res = await probeGitHub(patAuth);
    expect(res).toMatchObject({ mode: "pat", ok: true, rateRemaining: 4999 });
  });

  it("reports not-ok with the error when the token is rejected", async () => {
    server.use(
      http.get("https://api.github.com/rate_limit", () =>
        HttpResponse.json({ message: "Bad credentials" }, { status: 401 }),
      ),
    );

    const res = await probeGitHub(patAuth);
    expect(res.ok).toBe(false);
    expect(res.mode).toBe("pat");
    expect(res.error).toBeTruthy();
  });
});
