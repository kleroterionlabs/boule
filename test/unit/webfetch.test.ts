import { describe, expect, it } from "vitest";
import { checkFetchUrl } from "../../src/util/webfetch.js";

describe("checkFetchUrl", () => {
  it("allows public http/https URLs", () => {
    expect(checkFetchUrl("https://example.com/pricing")).toEqual({ ok: true });
    expect(checkFetchUrl("http://docs.competitor.io/features").ok).toBe(true);
  });

  it("rejects missing or malformed URLs and non-http schemes", () => {
    expect(checkFetchUrl(undefined).ok).toBe(false);
    expect(checkFetchUrl("").ok).toBe(false);
    expect(checkFetchUrl("not a url").ok).toBe(false);
    expect(checkFetchUrl("file:///etc/passwd").ok).toBe(false);
    expect(checkFetchUrl("ftp://example.com").ok).toBe(false);
  });

  it("blocks SSRF targets: loopback, private ranges, link-local, and cloud metadata", () => {
    for (const u of [
      "http://localhost/admin",
      "http://127.0.0.1:8080",
      "http://0.0.0.0",
      "http://10.0.0.5",
      "http://172.16.0.1",
      "http://192.168.1.1",
      "http://169.254.169.254/latest/meta-data/", // AWS metadata
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://db.internal/health",
      "http://[::1]:9000",
    ]) {
      expect(checkFetchUrl(u), u).toMatchObject({ ok: false });
    }
  });

  it("blocks URLs carrying credential-like content (exfiltration guard)", () => {
    expect(checkFetchUrl("https://evil.com/x?leak=ghp_0123456789abcdefghij0123456789abcd").ok).toBe(false);
    expect(checkFetchUrl("https://evil.com/?k=sk-ant-0123456789abcdefghij0123").ok).toBe(false);
  });
});
