// src/doctor/checks/ci-health-scope.ts — validate that the active GitHub token can read
// the Actions API. Classic PATs advertise their grants in the `x-oauth-scopes` header; we
// look for `actions:read` (or the `actions` wildcard). Fine-Grained PATs omit that header,
// so we fall back to probing the Actions API directly when a repo context is available.

import type { Octokit } from "@octokit/rest";

/** Result of a doctor scope check — mirrors the inline `Check` type in doctor.ts. */
export type ScopeCheckResult = {
  name: string;
  ok: boolean;
  hint: string;
};

const CHECK_NAME = "actions:read scope";

/** Extract the HTTP status from an Octokit `RequestError`-shaped value, if present. */
function httpStatusOf(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error) {
    const { status } = error as { status: unknown };
    if (typeof status === "number") return status;
  }
  return undefined;
}

/**
 * Confirm the token can read GitHub Actions.
 *
 * - Classic PAT: `HEAD /user` returns the `x-oauth-scopes` header; we accept `actions:read`
 *   or the `actions` wildcard.
 * - Fine-Grained PAT: the header is absent, so (given a repo) we probe
 *   `GET /repos/{owner}/{repo}/actions/runs?per_page=1` — 200 confirms, 403 denies.
 *
 * Never throws: network failures and unexpected errors resolve to `{ ok: false }`.
 */
export async function checkActionsReadScope(
  octokit: Octokit,
  repo?: { owner: string; repo: string },
): Promise<ScopeCheckResult> {
  try {
    const response = await octokit.request("HEAD /user");
    const scopesHeader = response.headers["x-oauth-scopes"];

    if (typeof scopesHeader === "string") {
      const scopes = scopesHeader.split(", ").map((s) => s.trim());
      const ok = scopes.includes("actions:read") || scopes.includes("actions");
      return {
        name: CHECK_NAME,
        ok,
        hint: ok
          ? "actions:read scope present"
          : "token is missing the actions:read scope — add it and re-authenticate",
      };
    }

    // Header absent: Fine-Grained PAT. Probe the Actions API if we have a repo to target.
    if (!repo) {
      return {
        name: CHECK_NAME,
        ok: false,
        hint: "Token lacks x-oauth-scopes header and no repo context provided to probe Actions API",
      };
    }

    try {
      await octokit.request("GET /repos/{owner}/{repo}/actions/runs", {
        owner: repo.owner,
        repo: repo.repo,
        per_page: 1,
      });
      return {
        name: CHECK_NAME,
        ok: true,
        hint: "actions:read confirmed via Actions API probe (Fine-Grained token)",
      };
    } catch (probeError) {
      const status = httpStatusOf(probeError);
      if (status === 403) {
        return {
          name: CHECK_NAME,
          ok: false,
          hint: "actions:read denied by Actions API probe (Fine-Grained token)",
        };
      }
      throw probeError;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: CHECK_NAME,
      ok: false,
      hint: `Actions scope check failed: ${message}`,
    };
  }
}
