import { describe, expect, it } from "vitest";
import { pickFallbackModel } from "../../src/orchestrator/orchestrate.js";

describe("pickFallbackModel", () => {
  it("uses the subagent model as fallback when it differs from the orchestrator", () => {
    expect(pickFallbackModel("claude-opus-4-8", "claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
  });

  it("omits the fallback when orchestrator and subagent are the same (SDK rejects equal models)", () => {
    expect(pickFallbackModel("claude-sonnet-4-6", "claude-sonnet-4-6")).toBeUndefined();
  });
});
