import { describe, expect, it } from "vitest";
import { sanitizeMentions } from "../../src/util/mentions.js";

describe("sanitizeMentions", () => {
  it("neutralizes user and team mentions, reporting the handles", () => {
    const r = sanitizeMentions("owner: @platform-lead and @kleroterionlabs/maintainers review this");
    expect(r.clean).toBe("owner: platform-lead and kleroterionlabs/maintainers review this");
    expect(r.clean).not.toContain("@");
    expect(r.stripped.sort()).toEqual(["kleroterionlabs/maintainers", "platform-lead"]);
  });

  it("leaves email addresses untouched", () => {
    const r = sanitizeMentions("contact william@gmail.com for access");
    expect(r.clean).toBe("contact william@gmail.com for access");
    expect(r.stripped).toEqual([]);
  });

  it("neutralizes a mention at the very start of the text", () => {
    expect(sanitizeMentions("@octocat please look").clean).toBe("octocat please look");
  });

  it("leaves clean text and code unchanged", () => {
    const clean = "The design uses an `email@host` token format and no mentions.";
    expect(sanitizeMentions(clean).clean).toBe(clean);
  });
});
