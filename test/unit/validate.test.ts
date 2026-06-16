import { describe, expect, it } from "vitest";
import { validateArtifact } from "../../src/quality/validate.js";

describe("validateArtifact", () => {
  it("passes a well-formed design and fails one missing Non-Goals", () => {
    const good =
      "## Problem\nx\n## Non-Goals\nNot doing y.\n## Job Stories\nWhen I sign in, I want to use a passkey so I can avoid passwords.";
    expect(validateArtifact("design", good).ok).toBe(true);

    const bad = "## Problem\nx\n## Job Stories\nWhen I sign in, I want to use a passkey so that it is fast.";
    const r = validateArtifact("design", bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/Non-Goals/i);
  });

  it("requires shall-form + Gherkin on requirements", () => {
    const good =
      "The system shall authenticate via OTP.\n## Acceptance\nGiven a user\nWhen they submit a code\nThen access is granted.";
    expect(validateArtifact("requirement", good).ok).toBe(true);

    const noShall = "Authenticate via OTP.\nGiven/When/Then present: Given x When y Then z";
    expect(validateArtifact("requirement", noShall).ok).toBe(false);

    const noGherkin = "The system shall authenticate via OTP within 300 ms.";
    expect(validateArtifact("requirement", noGherkin).ok).toBe(false);
  });

  it("warns on weasel NFR words but does not block", () => {
    const body = "The system shall be fast.\nGiven x When y Then z";
    const r = validateArtifact("requirement", body);
    expect(r.ok).toBe(true);
    expect(r.warnings.join()).toMatch(/non-numeric NFR/i);
  });

  it("rejects Five Forces on a competitor and requires it on a market overview", () => {
    expect(validateArtifact("competitor", "SWOT… Porter's Five Forces analysis").ok).toBe(false);
    expect(validateArtifact("market", "Rivalry is high.").ok).toBe(false);
    expect(validateArtifact("market", "Porter's Five Forces: rivalry high.").ok).toBe(true);
  });

  it("requires all four gap-grid columns", () => {
    expect(validateArtifact("gap", "Current: x | Desired: y | Gap: z | Action: w").ok).toBe(true);
    const r = validateArtifact("gap", "Current: x | Desired: y");
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/Gap, Action/);
  });

  it("passes decomposition kinds (task/feature/epic/spike) with no gate", () => {
    for (const k of ["task", "feature", "epic", "spike"] as const) {
      expect(validateArtifact(k, "anything").ok).toBe(true);
    }
  });
});
