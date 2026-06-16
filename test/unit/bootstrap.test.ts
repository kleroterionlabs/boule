import pino from "pino";
import { describe, expect, it } from "vitest";
import { ConfigSchema } from "../../src/config/schema.js";
import { type BootstrapSection, bootstrap } from "../../src/github/bootstrap.js";
import type { GitHubClient } from "../../src/github/client.js";

const log = pino({ level: "silent" });
const cfg = ConfigSchema.parse({ repo: "acme/widgets" });

function fakeGh(): { gh: GitHubClient; calls: string[] } {
  const calls: string[] = [];
  const gh = {
    withRest: async (_op: string, fn: (o: unknown) => unknown) =>
      fn({
        issues: {
          getLabel: async () => {
            calls.push("getLabel");
            return {};
          },
          createLabel: async () => {
            calls.push("createLabel");
            return {};
          },
        },
      }),
    graphql: async (_op: string, query: string) => {
      calls.push(`graphql:${query.includes("issueTypes") ? "types" : "other"}`);
      if (query.includes("issueTypes")) return { organization: { id: "O", issueTypes: { nodes: [] } } };
      return {};
    },
  } as unknown as GitHubClient;
  return { gh, calls };
}

describe("bootstrap scoping", () => {
  it("--labels-only touches labels and nothing else", async () => {
    const { gh, calls } = fakeGh();
    const only = new Set<BootstrapSection>(["labels"]);
    const report = await bootstrap(gh, cfg, log, { dryRun: false, only });

    expect(calls.some((c) => c === "getLabel")).toBe(true);
    expect(calls.some((c) => c.startsWith("graphql"))).toBe(false); // no types/categories/project work
    expect(report.labels.existed.length).toBeGreaterThan(0);
    expect(report.issueTypes.created).toHaveLength(0);
  });

  it("--types-only resolves issue types and skips label REST calls", async () => {
    const { gh, calls } = fakeGh();
    const only = new Set<BootstrapSection>(["types"]);
    await bootstrap(gh, cfg, log, { dryRun: false, only });

    expect(calls.some((c) => c === "getLabel")).toBe(false);
    expect(calls.some((c) => c === "graphql:types")).toBe(true);
  });

  it("no scope ⇒ all sections run (labels + a graphql probe)", async () => {
    const { gh, calls } = fakeGh();
    await bootstrap(gh, cfg, log, { dryRun: false });
    expect(calls.some((c) => c === "getLabel")).toBe(true);
    expect(calls.some((c) => c.startsWith("graphql"))).toBe(true);
  });
});
