import type { Octokit } from "@octokit/rest";
import { describe, expect, it, vi } from "vitest";
import { checkActionsReadScope } from "../../src/doctor/checks/ci-health-scope.js";

/** Build a stub Octokit exposing only the `request` method the check uses. */
function octokitWith(request: ReturnType<typeof vi.fn>): Octokit {
  return { request } as unknown as Octokit;
}

/** A `HEAD /user` response carrying the given `x-oauth-scopes` header value. */
function headUserResponse(scopes?: string) {
  const headers: Record<string, string> = {};
  if (scopes !== undefined) headers["x-oauth-scopes"] = scopes;
  return { status: 200, headers, data: undefined };
}

describe("checkActionsReadScope", () => {
  it("Classic token with actions:read scope → ok with hint containing 'present'", async () => {
    const request = vi.fn().mockResolvedValueOnce(headUserResponse("repo, actions:read"));
    const result = await checkActionsReadScope(octokitWith(request));
    expect(result.ok).toBe(true);
    expect(result.hint).toContain("present");
  });

  it("Classic token without actions scope → not ok", async () => {
    const request = vi.fn().mockResolvedValueOnce(headUserResponse("repo, read:org"));
    const result = await checkActionsReadScope(octokitWith(request));
    expect(result.ok).toBe(false);
  });

  it("Classic token with wildcard actions scope → ok", async () => {
    const request = vi.fn().mockResolvedValueOnce(headUserResponse("actions"));
    const result = await checkActionsReadScope(octokitWith(request));
    expect(result.ok).toBe(true);
  });

  it("Fine-Grained token, Actions API returns 200 → ok with confirm hint", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(headUserResponse(undefined))
      .mockResolvedValueOnce({ status: 200, headers: {}, data: { total_count: 0, workflow_runs: [] } });

    const result = await checkActionsReadScope(octokitWith(request), { owner: "o", repo: "r" });
    expect(result.ok).toBe(true);
    expect(result.hint).toBe("actions:read confirmed via Actions API probe (Fine-Grained token)");

    // The probe targeted the right repo via the Actions runs endpoint.
    expect(request).toHaveBeenLastCalledWith("GET /repos/{owner}/{repo}/actions/runs", {
      owner: "o",
      repo: "r",
      per_page: 1,
    });
  });

  it("Fine-Grained token, Actions API returns 403 → not ok with deny hint", async () => {
    const forbidden = Object.assign(new Error("Forbidden"), { status: 403 });
    const request = vi
      .fn()
      .mockResolvedValueOnce(headUserResponse(undefined))
      .mockRejectedValueOnce(forbidden);

    const result = await checkActionsReadScope(octokitWith(request), { owner: "o", repo: "r" });
    expect(result.ok).toBe(false);
    expect(result.hint).toBe("actions:read denied by Actions API probe (Fine-Grained token)");
  });

  it("Fine-Grained token, no repo context → not ok with 'no repo context provided' hint", async () => {
    const request = vi.fn().mockResolvedValueOnce(headUserResponse(undefined));
    const result = await checkActionsReadScope(octokitWith(request));
    expect(result.ok).toBe(false);
    expect(result.hint).toContain("no repo context provided");
  });

  it("Network error → not ok and does not throw", async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(checkActionsReadScope(octokitWith(request))).resolves.toMatchObject({ ok: false });
  });
});
