import { describe, expect, it } from "vitest";
import { resumePrompt } from "../../src/orchestrator/resume.js";

describe("resumePrompt", () => {
  it("re-anchors on the workflow and embeds the original instruction", () => {
    const p = resumePrompt("design", "Design passwordless sign-in.");
    expect(p).toContain("RESUMING");
    expect(p).toContain("`design`");
    expect(p).toContain("Design passwordless sign-in.");
  });

  it("tells the agent not to start over and that re-emitting is safe", () => {
    const p = resumePrompt("requirements", "x");
    expect(p).toMatch(/do NOT start over/i);
    expect(p).toMatch(/no-op|idempotent/i);
  });
});
