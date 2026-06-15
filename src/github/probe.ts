// src/github/probe.ts — live credential check. Mints a token and hits the API so that
// wiring problems (bad private key, wrong installation id, missing scopes) surface in
// `boule doctor`, not midway through an autonomous run.
import pino from "pino";
import type { AuthConfig } from "../config/auth.js";
import { createGitHubClient } from "./client.js";

export interface GitHubProbe {
  mode: "app" | "pat";
  ok: boolean;
  /** App: the installation account/owner. PAT: omitted. */
  identity?: string;
  /** App: number of repositories the installation can access. */
  repoCount?: number;
  /** App: accessible repositories (owner/name). */
  repos?: string[];
  /** PAT: remaining REST requests this hour (proves the token authenticates). */
  rateRemaining?: number;
  error?: string;
}

/**
 * Exercise the resolved GitHub credentials end-to-end:
 * - App mode → mint an installation token (signs a JWT with the private key) and list the
 *   repositories the installation can act on.
 * - PAT mode → confirm the token authenticates via the rate-limit endpoint.
 */
export async function probeGitHub(auth: AuthConfig): Promise<GitHubProbe> {
  const mode: "app" | "pat" = auth.github.kind === "app" ? "app" : "pat";
  const log = pino({ level: "silent" }); // one-shot probe — nothing to log

  try {
    const gh = await createGitHubClient(auth, log);

    if (mode === "app") {
      const res = await gh.withRest("read", (o) =>
        o.request("GET /installation/repositories", { per_page: 100 }),
      );
      const repos = res.data.repositories.map((r) => r.full_name);
      const owner = repos[0]?.split("/")[0];
      return {
        mode,
        ok: true,
        repoCount: res.data.total_count,
        repos,
        ...(owner ? { identity: owner } : {}),
      };
    }

    const rl = await gh.withRest("read", (o) => o.request("GET /rate_limit"));
    return { mode, ok: true, rateRemaining: rl.data.rate.remaining };
  } catch (e) {
    return { mode, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
