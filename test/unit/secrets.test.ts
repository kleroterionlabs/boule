import { describe, expect, it } from "vitest";
import { scrubSecrets } from "../../src/util/secrets.js";

describe("scrubSecrets", () => {
  it("redacts a GitHub token and an Anthropic key, reporting the kinds", () => {
    const text = `token ghp_${"a".repeat(36)} key sk-ant-api03-${"b".repeat(40)} end`;
    const r = scrubSecrets(text);
    expect(r.clean).not.toContain("ghp_");
    expect(r.clean).not.toContain("sk-ant-");
    expect(r.clean).toContain("[REDACTED:github-token]");
    expect(r.found).toContain("github-token");
    expect(r.found).toContain("anthropic-key");
  });

  it("redacts a PEM private-key block", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIabc123\n-----END RSA PRIVATE KEY-----";
    const r = scrubSecrets(`key:\n${pem}\ndone`);
    expect(r.clean).not.toContain("PRIVATE KEY");
    expect(r.found).toContain("private-key");
  });

  it("leaves clean text untouched", () => {
    const clean = "A normal design body. The auth module signs in users.";
    const r = scrubSecrets(clean);
    expect(r.found).toHaveLength(0);
    expect(r.clean).toBe(clean);
  });
});
