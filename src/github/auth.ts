// src/github/auth.ts — turns a GithubAuth into a usable bearer token. Type defs + minting are now
// single-sourced from @kleroterion/koine; this re-export shim preserves the "./auth.js" import path.
export {
  mintToken,
  decodePrivateKey,
  type AuthConfig,
  type GitHubAuth,
  type GitHubAuth as GithubAuth,
} from "@kleroterion/koine";
