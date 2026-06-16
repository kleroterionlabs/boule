// src/util/webfetch.ts — gate for the read-only WebFetch tool. Research agents may pull public web
// pages for evidence, but WebFetch is a network egress: it must not reach internal services (SSRF)
// or smuggle credentials out in the URL (exfiltration). It is GET-only, so there is no write surface.
import { scrubSecrets } from "./secrets.js";

export interface FetchVerdict {
  ok: boolean;
  reason?: string;
}

const BLOCKED_HOSTS = new Set(["localhost", "0.0.0.0", "metadata.google.internal", "metadata.goog"]);

/** IPv4/IPv6 loopback, link-local, and private ranges — the SSRF blocklist. */
function isPrivateAddress(host: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127) return true; // this-host, private, loopback
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    return false;
  }
  if (host === "::1") return true; // IPv6 loopback
  if (host.startsWith("fe80:")) return true; // IPv6 link-local
  if (host.startsWith("fc") || host.startsWith("fd")) return true; // IPv6 unique-local
  return false;
}

/**
 * Decide whether a WebFetch URL is safe to fetch. Allows only http/https to public hosts and rejects
 * any URL carrying credential-like content (the exfiltration guard reuses the outbound secret scanner).
 */
export function checkFetchUrl(raw: unknown): FetchVerdict {
  if (typeof raw !== "string" || raw.trim() === "") return { ok: false, reason: "missing url" };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "malformed url" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `unsupported scheme "${url.protocol}" (only http/https)` };
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".internal") || host.endsWith(".local")) {
    return { ok: false, reason: "blocked host (SSRF guard)" };
  }
  if (isPrivateAddress(host)) {
    return { ok: false, reason: "private/loopback/link-local address (SSRF guard)" };
  }
  // Exfiltration guard: a credential smuggled into the URL must never leave the box.
  if (scrubSecrets(raw).found.length > 0) {
    return { ok: false, reason: "url contains credential-like content (exfiltration guard)" };
  }
  return { ok: true };
}
