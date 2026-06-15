// test/unit/idempotency.test.ts — load-bearing dedupe logic, network-free.
import { describe, expect, it } from "vitest";
import {
  bouleId,
  contentHash,
  parseBouleBlock,
  stripBouleBlock,
  withBouleBlock,
} from "../../src/util/idempotency.js";

describe("bouleId", () => {
  it("is stable and slug-normalized for the same logical work", () => {
    expect(bouleId("requirement", "One-time-code sign-in")).toBe("requirement:one-time-code-sign-in");
    expect(bouleId("requirement", "One-time-code  sign-in!")).toBe(
      bouleId("requirement", "One-time-code sign-in"),
    );
  });
});

describe("contentHash", () => {
  it("ignores trailing whitespace and CRLF", () => {
    expect(contentHash("line a\nline b")).toBe(contentHash("line a  \r\nline b\n"));
  });
  it("changes when semantic content changes", () => {
    expect(contentHash("do it")).not.toBe(contentHash("do it now"));
  });
  it("excludes an embedded boule block from the hash", () => {
    const withBlock = withBouleBlock("the body", { kind: "task", bouleId: "task:x" });
    expect(contentHash(withBlock)).toBe(contentHash("the body"));
  });
});

describe("boule block round-trip", () => {
  it("serializes then parses to the same identity", () => {
    const body = withBouleBlock("## Requirement\n\nThe system shall…", {
      kind: "requirement",
      bouleId: "requirement:otp",
      parent: "design:passwordless-auth",
      runId: "run_1",
    });
    const parsed = parseBouleBlock(body);
    expect(parsed?.kind).toBe("requirement");
    expect(parsed?.bouleId).toBe("requirement:otp");
    expect(parsed?.parent).toBe("design:passwordless-auth");
    expect(stripBouleBlock(body).trim()).toBe("## Requirement\n\nThe system shall…");
  });
  it("returns null for a body with no block", () => {
    expect(parseBouleBlock("plain human issue")).toBeNull();
  });
});
