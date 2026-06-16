import type { FieldRef, ProjectFieldValues } from "../core/types.js";
// src/github/projects.ts — Projects v2 is GraphQL-only; all IDs are opaque node ids.
import type { GitHubClient } from "./client.js";
import { ADD_PROJECT_ITEM, DELETE_PROJECT_ITEM, SET_FIELD_VALUE } from "./mutations.js";
import { PROJECT_ITEMS, PROJECT_SCHEMA } from "./queries.js";

interface RawField {
  id: string;
  name: string;
  options?: { id: string; name: string }[];
  configuration?: { iterations: { id: string; startDate: string }[] };
}

export async function readProjectSchema(
  gh: GitHubClient,
  projectId: string,
): Promise<Record<string, FieldRef>> {
  const data = await gh.graphql<{ node: { fields: { nodes: RawField[] } } }>("read", PROJECT_SCHEMA, {
    projectId,
  });
  const out: Record<string, FieldRef> = {};
  for (const f of data.node.fields.nodes) {
    const kind: FieldRef["kind"] = f.options ? "SINGLE_SELECT" : f.configuration ? "ITERATION" : "NUMBER"; // TEXT/DATE refined by caller as needed
    out[f.name] = {
      id: f.id,
      kind,
      ...(f.options && { options: Object.fromEntries(f.options.map((o) => [o.name, o.id])) }),
    };
  }
  return out;
}

export async function addItem(gh: GitHubClient, projectId: string, issueNodeId: string): Promise<string> {
  const data = await gh.graphql<{ addProjectV2ItemById: { item: { id: string } } }>(
    "write",
    ADD_PROJECT_ITEM,
    { projectId, contentId: issueNodeId },
  );
  return data.addProjectV2ItemById.item.id;
}

export interface ProjectItem {
  itemId: string;
  type: string; // "Issue" | "PullRequest" | "DraftIssue"
  number: number | null;
  title: string | null;
  url: string | null;
  state: string | null;
  fields: Record<string, string | number>; // field name → current value
}

interface RawItemNode {
  id: string;
  content: { __typename?: string; number?: number; title?: string; url?: string; state?: string } | null;
  fieldValues: {
    nodes: Array<{
      name?: string;
      number?: number;
      text?: string;
      title?: string;
      field?: { name?: string };
    }>;
  };
}

/** Read the board's items with their backing issue + current field values (paginated, capped). */
export async function listProjectItems(
  gh: GitHubClient,
  projectId: string,
  max = 500,
): Promise<{ items: ProjectItem[]; truncated: boolean }> {
  const items: ProjectItem[] = [];
  let cursor: string | null = null;
  let truncated = false;

  while (items.length < max) {
    const data: {
      node: { items: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawItemNode[] } };
    } = await gh.graphql("read", PROJECT_ITEMS, { projectId, cursor });
    const page = data.node?.items;
    if (!page) break;
    for (const n of page.nodes) {
      if (items.length >= max) {
        truncated = true; // more nodes remain in this very page
        break;
      }
      const fields: Record<string, string | number> = {};
      for (const fv of n.fieldValues.nodes) {
        const key = fv.field?.name;
        if (!key) continue; // a field value with no resolvable field name (rare); skip
        const val = fv.name ?? fv.text ?? fv.title ?? fv.number;
        if (val !== undefined) fields[key] = val;
      }
      items.push({
        itemId: n.id,
        type: n.content?.__typename ?? "DraftIssue",
        number: n.content?.number ?? null,
        title: n.content?.title ?? null,
        url: n.content?.url ?? null,
        state: n.content?.state ?? null,
        fields,
      });
    }
    if (truncated) break;
    if (items.length >= max) {
      // filled exactly to the cap at a page boundary — more exist iff another page follows
      truncated = page.pageInfo.hasNextPage;
      break;
    }
    if (!page.pageInfo.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
  }
  return { items, truncated };
}

/** Remove a single item from the board (does NOT close/delete the backing issue). */
export async function removeProjectItem(gh: GitHubClient, projectId: string, itemId: string): Promise<void> {
  await gh.graphql("write", DELETE_PROJECT_ITEM, { projectId, itemId });
}

/** Write all provided field values for an item using the resolved schema. */
export async function setItemFields(
  gh: GitHubClient,
  projectId: string,
  itemId: string,
  schema: Record<string, FieldRef>,
  values: ProjectFieldValues,
): Promise<void> {
  for (const [name, raw] of Object.entries(values)) {
    if (raw === undefined) continue;
    const field = schema[name];
    if (!field) continue;
    const value = encodeFieldValue(field, raw);
    if (!value) continue;
    await gh.graphql("write", SET_FIELD_VALUE, { projectId, itemId, fieldId: field.id, value });
  }
}

function encodeFieldValue(field: FieldRef, raw: unknown): Record<string, unknown> | null {
  switch (field.kind) {
    case "NUMBER":
      return { number: Number(raw) };
    case "SINGLE_SELECT": {
      const optId = field.options?.[String(raw)];
      return optId ? { singleSelectOptionId: optId } : null;
    }
    case "ITERATION":
      return { iterationId: String(raw) };
    case "DATE":
      return { date: String(raw) };
    default:
      return { text: String(raw) };
  }
}
