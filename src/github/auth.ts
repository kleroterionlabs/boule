// src/github/auth.ts — turns a GithubAuth into a usable bearer token.
import { createAppAuth } from "@octokit/auth-app";
import type { GithubAuth } from "../config/auth.js";

export async function mintToken(auth: GithubAuth): Promise<string> {
  if (auth.kind === "pat") return auth.token;
  const appAuth = createAppAuth({
    appId: auth.appId,
    privateKey: auth.privateKey,
    installationId: auth.installationId,
  });
  const { token } = await appAuth({ type: "installation" });
  return token;
}
