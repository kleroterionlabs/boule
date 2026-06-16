import pino from "pino";
import { describe, expect, it } from "vitest";
import { type GuardState, isDenied, isWrite, makeCanUseTool } from "../../src/tools/guards.js";

const log = pino({ level: "silent" });
const base = (over: Partial<GuardState> = {}): GuardState => ({
  dryRun: false,
  halted: false,
  writes: 0,
  maxWrites: 300,
  log,
  ...over,
});

// CanUseTool's third arg (options) is unused by our gate; pass a minimal stub.
const opts = {} as Parameters<ReturnType<typeof makeCanUseTool>>[2];

describe("guards", () => {
  it("classifies write and denied tools", () => {
    expect(isWrite("mcp__github__gh_upsert_issue")).toBe(true);
    expect(isWrite("mcp__github__gh_close_issue")).toBe(true);
    expect(isWrite("mcp__github__gh_remove_project_item")).toBe(true);
    expect(isWrite("Read")).toBe(false);
    expect(isDenied("Bash")).toBe(true);
    expect(isDenied("Write")).toBe(true);
    expect(isDenied("WebFetch")).toBe(false); // WebFetch is allowed but URL-gated, not denied outright
    expect(isDenied("Read")).toBe(false);
  });

  it("denies shell / file-mutation tools outright", async () => {
    const gate = makeCanUseTool(base());
    for (const t of ["Bash", "Write", "Edit", "NotebookEdit"]) {
      expect((await gate(t, {}, opts)).behavior).toBe("deny");
    }
  });

  it("allows read-only tools", async () => {
    const gate = makeCanUseTool(base());
    expect((await gate("Read", {}, opts)).behavior).toBe("allow");
    expect((await gate("mcp__github__gh_find_issue", {}, opts)).behavior).toBe("allow");
    expect((await gate("mcp__github__gh_list_project_items", {}, opts)).behavior).toBe("allow");
  });

  it("gates WebFetch: allows public URLs, denies SSRF/exfiltration", async () => {
    const gate = makeCanUseTool(base());
    expect((await gate("WebFetch", { url: "https://example.com" }, opts)).behavior).toBe("allow");
    expect((await gate("WebFetch", { url: "http://169.254.169.254/" }, opts)).behavior).toBe("deny");
    expect((await gate("WebFetch", { url: "ftp://example.com" }, opts)).behavior).toBe("deny");
  });

  it("denies writes under dry-run and when over the blast-radius cap", async () => {
    expect(
      (await makeCanUseTool(base({ dryRun: true }))("mcp__github__gh_upsert_issue", {}, opts)).behavior,
    ).toBe("deny");
    expect(
      (await makeCanUseTool(base({ writes: 300, maxWrites: 300 }))("mcp__github__gh_upsert_issue", {}, opts))
        .behavior,
    ).toBe("deny");
  });

  it("polls the live halt switch and denies once it trips", async () => {
    let tripped = false;
    const gate = makeCanUseTool(base({ checkHalt: async () => tripped }));
    expect((await gate("mcp__github__gh_upsert_issue", {}, opts)).behavior).toBe("allow"); // writes 0→1
    tripped = true;
    // next poll happens at writes % 5 === 0; advance to a polling boundary
    const state = base({ checkHalt: async () => true });
    const gate2 = makeCanUseTool(state);
    const res = await gate2("mcp__github__gh_upsert_issue", {}, opts); // writes=0 ⇒ polls ⇒ halted
    expect(res.behavior).toBe("deny");
  });
});
