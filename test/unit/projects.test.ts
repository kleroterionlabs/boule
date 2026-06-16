import { describe, expect, it, vi } from "vitest";
import type { GitHubClient } from "../../src/github/client.js";
import { listProjectItems, removeProjectItem } from "../../src/github/projects.js";

const itemsPage = (nodes: unknown[], hasNextPage = false, endCursor: string | null = null) => ({
  node: { items: { pageInfo: { hasNextPage, endCursor }, nodes } },
});

const node = (over: Record<string, unknown> = {}) => ({
  id: "ITEM_1",
  content: { __typename: "Issue", number: 12, title: "Login", url: "u", state: "OPEN" },
  fieldValues: {
    nodes: [
      { name: "Ready", field: { name: "Status" } },
      { number: 7, field: { name: "RICE" } },
      { field: { name: "Orphan" } }, // value-less; ignored
      { title: "Sprint 3", field: {} }, // no field name; skipped
    ],
  },
  ...over,
});

const stub = (graphql: GitHubClient["graphql"]): GitHubClient => ({ graphql }) as unknown as GitHubClient;

describe("listProjectItems", () => {
  it("maps items to itemId, backing issue, and field-name → value", async () => {
    const graphql = vi.fn().mockResolvedValue(itemsPage([node()]));
    const { items, truncated } = await listProjectItems(stub(graphql), "PROJ");
    expect(truncated).toBe(false);
    expect(items[0]).toEqual({
      itemId: "ITEM_1",
      type: "Issue",
      number: 12,
      title: "Login",
      url: "u",
      state: "OPEN",
      fields: { Status: "Ready", RICE: 7 }, // value-less / nameless field entries dropped
    });
  });

  it("paginates and reports truncation at the cap", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(itemsPage([node({ id: "A" }), node({ id: "B" })], true, "c1"))
      .mockResolvedValueOnce(itemsPage([node({ id: "C" })]));
    const { items, truncated } = await listProjectItems(stub(graphql), "PROJ", 2);
    expect(items.map((i) => i.itemId)).toEqual(["A", "B"]);
    expect(truncated).toBe(true);
    expect(graphql).toHaveBeenCalledTimes(1); // cap hit on page 1 — no second fetch
  });

  it("removeProjectItem issues a write mutation", async () => {
    const graphql = vi.fn().mockResolvedValue({});
    await removeProjectItem(stub(graphql), "PROJ", "ITEM_9");
    expect(graphql).toHaveBeenCalledWith("write", expect.stringContaining("deleteProjectV2Item"), {
      projectId: "PROJ",
      itemId: "ITEM_9",
    });
  });
});
