import { describe, expect, it } from "vitest";
import { validateArtifact } from "../../src/quality/validate.js";

describe("validateArtifact", () => {
  const goodDesign = [
    "## Problem",
    "x",
    "## Non-Goals",
    "Not doing y.",
    "## Job Stories",
    "When I sign in, I want to use a passkey so I can avoid passwords.",
    "## Approaches Considered",
    "A1 passkeys / A2 magic link. Chosen: A1.",
    "## Feasibility",
    "WebAuthn is available; no new storage needed.",
    "## Observability",
    "Log auth outcome + exit code.",
  ].join("\n");

  it("passes a well-formed design and fails when a required section is missing", () => {
    expect(validateArtifact("design", goodDesign).ok).toBe(true);

    // missing Non-Goals
    expect(validateArtifact("design", goodDesign.replace("## Non-Goals", "## Nope")).ok).toBe(false);
    // missing Feasibility / Observability / Approaches each block
    for (const h of ["## Approaches Considered", "## Feasibility", "## Observability"]) {
      const r = validateArtifact("design", goodDesign.replace(h, "## Other"));
      expect(r.ok).toBe(false);
    }
  });

  const goodReq = [
    "Traces-to: JS1 / G1",
    "The system shall authenticate via OTP.",
    "## Acceptance",
    "Given a user When they submit a code Then access is granted.",
    "## Feasibility",
    "Reuses the existing auth client.",
    "## Observability",
    "Emits an auth event with trace id.",
  ].join("\n");

  it("requires shall-form, Gherkin, traceability, feasibility, and observability on requirements", () => {
    expect(validateArtifact("requirement", goodReq).ok).toBe(true);

    expect(validateArtifact("requirement", goodReq.replace("shall ", "will ")).ok).toBe(false); // no shall
    expect(validateArtifact("requirement", goodReq.replace("Traces-to: JS1 / G1", "")).ok).toBe(false);
    expect(validateArtifact("requirement", goodReq.replace("## Feasibility", "## X")).ok).toBe(false);
    expect(validateArtifact("requirement", goodReq.replace("## Observability", "## X")).ok).toBe(false);
    const noGherkin = "Traces-to: G1\nThe system shall X.\n## Feasibility\na\n## Observability\nb";
    expect(validateArtifact("requirement", noGherkin).ok).toBe(false);
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
