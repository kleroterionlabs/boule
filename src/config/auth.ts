// src/config/auth.ts — secrets ingress is env-only; AuthConfig is never written to disk/logs.
import { readFileSync } from "node:fs";
import { ConfigError } from "../util/errors.js";

export type GithubAuth =
  | { kind: "app"; appId: string; installationId: number; privateKey: string }
  | { kind: "pat"; token: string };

export interface AuthConfig {
  github: GithubAuth;
  anthropicApiKey?: string; // undefined ⇒ SDK falls back to subscription login
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
  const anthropicApiKey = env.ANTHROPIC_API_KEY || undefined;

  if (env.GITHUB_APP_ID && env.GITHUB_APP_INSTALLATION_ID && env.GITHUB_APP_PRIVATE_KEY) {
    return {
      anthropicApiKey,
      github: {
        kind: "app",
        appId: env.GITHUB_APP_ID,
        installationId: Number(env.GITHUB_APP_INSTALLATION_ID),
        privateKey: readKeyMaybeBase64(env.GITHUB_APP_PRIVATE_KEY),
      },
    };
  }
  if (env.GITHUB_TOKEN) {
    return { anthropicApiKey, github: { kind: "pat", token: env.GITHUB_TOKEN } };
  }
  throw new ConfigError(
    "No GitHub credentials. Set GITHUB_TOKEN, or the GITHUB_APP_* trio. Run `boule doctor`.",
  );
}
