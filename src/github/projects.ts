import type { FieldRef, ProjectFieldValues } from "../core/types.js";
// src/github/projects.ts — Projects v2 is GraphQL-only; all IDs are opaque node ids.
import type { GitHubClient } from "./client.js";
import { ADD_PROJECT_ITEM, SET_FIELD_VALUE } from "./mutations.js";
import { PROJECT_SCHEMA } from "./queries.js";

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
