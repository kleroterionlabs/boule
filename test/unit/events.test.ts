import { afterEach, describe, expect, it, vi } from "vitest";
import { makeEmitter } from "../../src/observability/events.js";
import { Ledger } from "../../src/observability/ledger.js";

afterEach(() => vi.restoreAllMocks());

describe("makeEmitter", () => {
  it("is a no-op when json is false", () => {
    const spy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    makeEmitter(false)({ type: "run_started", runId: "R1", workflow: "design" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("writes one NDJSON line per event with a timestamp and type", () => {
    const spy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    makeEmitter(true)({ type: "run_started", runId: "R1", workflow: "design" });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0]?.[0] as string;
    expect(line.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(line);
    expect(parsed.type).toBe("run_started");
    expect(parsed.runId).toBe("R1");
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("Ledger onRecord", () => {
  it("invokes the callback with the full (timestamped) entry as writes happen", () => {
    const seen: string[] = [];
    const l = new Ledger((e) => seen.push(e.action));
    l.record({ action: "issue.create", number: 1, nodeId: "n1", url: "u1" });
    l.record({ action: "discussion.create", number: 2, url: "u2" });
    expect(seen).toEqual(["issue.create", "discussion.create"]);
    expect(l.entries[0]?.ts).toBeTruthy();
  });
});
