// src/util/version.ts — single source of truth for the CLI version: package.json.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let cached: string | null = null;

/** Boule's version from package.json. Resolves whether bundled (dist/) or run from source. */
export function getVersion(): string {
  if (cached) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  for (const rel of ["../package.json", "../../package.json"]) {
    try {
      const pkg = JSON.parse(readFileSync(join(here, rel), "utf8")) as { version?: string };
      if (pkg.version) {
        cached = pkg.version;
        return cached;
      }
    } catch {
      // try the next candidate path
    }
  }
  cached = "0.0.0";
  return cached;
}
