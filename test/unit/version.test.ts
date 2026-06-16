import { describe, expect, it } from "vitest";
import { getVersion } from "../../src/util/version.js";

describe("getVersion", () => {
  it("returns a semver-shaped string from package.json", () => {
    expect(getVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("is cached / stable across calls", () => {
    expect(getVersion()).toBe(getVersion());
  });
});
