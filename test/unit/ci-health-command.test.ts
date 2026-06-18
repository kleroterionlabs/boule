// test/unit/ci-health-command.test.ts — acceptance criteria for the `ci-health` command scaffold.
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CiHealthDeps,
  type CiHealthSummary,
  registerCiHealth,
} from "../../src/cli/commands/ci-health.js";
import { buildProgram } from "../../src/cli/index.js";

/** Capture everything written to stdout/stderr during one parse. */
function captureIo(): { out: () => string; err: () => string; restore: () => void } {
  let out = "";
  let err = "";
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
  const restore = () => {
    outSpy.mockRestore();
    errSpy.mockRestore();
  };
  return { out: () => out, err: () => err, restore };
}

const summary: CiHealthSummary = {
  since: "2024-01-01T00:00:00.000Z",
  rows: [{ repo: "acme/widgets", workflow: "CI", runs: 10, failures: 3, verdict: "flaky" }],
};

/** Mock pipeline that returns a fixed, non-empty summary without any network. */
function mockDeps(): CiHealthDeps {
  return {
    fetchAllWorkflowRuns: vi.fn(async () => []),
    classifyFlakiness: vi.fn((runs) => runs),
    buildSummary: vi.fn(() => summary),
  };
}

/** A standalone program carrying only the ci-health command with injected deps. */
function programWith(deps: CiHealthDeps): Command {
  const program = new Command();
  program.name("boule").exitOverride().option("--json", "machine-readable output", false);
  registerCiHealth(program, deps);
  program.configureOutput({
    writeOut: (s) => process.stdout.write(s),
    writeErr: (s) => process.stderr.write(s),
  });
  return program;
}

describe("boule ci-health command", () => {
  let io: ReturnType<typeof captureIo>;

  beforeEach(() => {
    io = captureIo();
  });
  afterEach(() => {
    io.restore();
    vi.restoreAllMocks();
  });

  it("prints --help usage without error", async () => {
    const program = programWith(mockDeps());
    // Commander throws a `commander.helpDisplayed`-coded error after printing help.
    await expect(program.parseAsync(["node", "boule", "ci-health", "--help"])).rejects.toMatchObject({
      code: "commander.helpDisplayed",
    });
    expect(io.out()).toContain("ci-health");
    expect(io.out()).toContain("--since");
    expect(io.out()).toContain("--skip-commit-check");
  });

  it("registers ci-health on the full program built by buildProgram()", () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("ci-health");
  });

  it("prints a table to stdout and exits 0 (mocked API)", async () => {
    const deps = mockDeps();
    const program = programWith(deps);
    await program.parseAsync(["node", "boule", "ci-health"]);

    expect(deps.fetchAllWorkflowRuns).toHaveBeenCalledOnce();
    expect(deps.classifyFlakiness).toHaveBeenCalledOnce();
    expect(deps.buildSummary).toHaveBeenCalledOnce();
    const out = io.out();
    expect(out).toContain("CI health since");
    expect(out).toContain("acme/widgets");
    expect(out).toContain("flaky");
    // Plain table output is not valid JSON.
    expect(() => JSON.parse(out)).toThrow();
  });

  it("prints JSON to stdout and exits 0 with --json (mocked API)", async () => {
    const deps = mockDeps();
    const program = programWith(deps);
    await program.parseAsync(["node", "boule", "--json", "ci-health"]);

    const parsed = JSON.parse(io.out());
    expect(parsed).toEqual(summary);
  });

  it("calls the pipeline in order: fetch → classify → buildSummary", async () => {
    const order: string[] = [];
    const deps: CiHealthDeps = {
      fetchAllWorkflowRuns: vi.fn(async () => {
        order.push("fetch");
        return [];
      }),
      classifyFlakiness: vi.fn((runs) => {
        order.push("classify");
        return runs;
      }),
      buildSummary: vi.fn(() => {
        order.push("summary");
        return summary;
      }),
    };
    await programWith(deps).parseAsync(["node", "boule", "ci-health"]);
    expect(order).toEqual(["fetch", "classify", "summary"]);
  });

  it("errors and exits 1 on an unrecognised flag", async () => {
    const program = programWith(mockDeps());
    await expect(
      program.parseAsync(["node", "boule", "ci-health", "--definitely-not-a-flag"]),
    ).rejects.toMatchObject({ code: "commander.unknownOption", exitCode: 1 });
  });

  it("is reachable via the `cih` alias", async () => {
    const deps = mockDeps();
    await programWith(deps).parseAsync(["node", "boule", "cih"]);
    expect(deps.buildSummary).toHaveBeenCalledOnce();
    expect(io.out()).toContain("acme/widgets");
  });
});
