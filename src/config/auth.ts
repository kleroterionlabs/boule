// src/config/auth.ts — secrets ingress is env-only; AuthConfig is never written to disk/logs.
import { readFileSync } from "node:fs";
import { ConfigError } from "../util/errors.js";

export type GithubAuth =
  | { kind: "app"; appId: string; installationId: number; privateKey: string }
  | { kind: "pat"; token: string };

export type ClaudeAuthKind = "oauth-token" | "api-key" | "subscription-login";

export interface AuthConfig {
  github: GithubAuth;
  /**
   * How the Claude Agent SDK will authenticate. The SDK reads the actual token from the
   * environment itself (CLAUDE_CODE_OAUTH_TOKEN, else ANTHROPIC_API_KEY), so we only record
   * which path is in play — no Claude secret is ever held on this object.
   */
  claudeAuth: ClaudeAuthKind;
}

function readKeyMaybeBase64(v: string): string {
  if (v.includes("BEGIN") && v.includes("PRIVATE KEY")) return v;
  // allow a path or base64 to survive CI secret stores
  try {
    if (v.startsWith("/") || v.startsWith(".")) return readFileSync(v, "utf8");
  } catch {
    /* fall through to base64 */
  }
  return Buffer.from(v, "base64").toString("utf8");
}

export function resolveAuth(env: NodeJS.ProcessEnv): AuthConfig {
  // Prefer a Claude Code OAuth token (`claude setup-token` → a Pro/Max subscription, ideal for CI),
  // then a metered API key, else an existing `claude login` session the SDK discovers on its own.
  const claudeAuth: ClaudeAuthKind = env.CLAUDE_CODE_OAUTH_TOKEN
    ? "oauth-token"
    : env.ANTHROPIC_API_KEY
      ? "api-key"
      : "subscription-login";

  if (env.BOULE_APP_ID && env.BOULE_APP_INSTALLATION_ID && env.BOULE_APP_PRIVATE_KEY) {
    return {
      claudeAuth,
      github: {
        kind: "app",
        appId: env.BOULE_APP_ID,
        installationId: Number(env.BOULE_APP_INSTALLATION_ID),
        privateKey: readKeyMaybeBase64(env.BOULE_APP_PRIVATE_KEY),
      },
    };
  }
  if (env.GITHUB_TOKEN) {
    return { claudeAuth, github: { kind: "pat", token: env.GITHUB_TOKEN } };
  }
  throw new ConfigError(
    "No GitHub credentials. Set GITHUB_TOKEN, or the BOULE_APP_* trio. Run `boule doctor`.",
  );
}
