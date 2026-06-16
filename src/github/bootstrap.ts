// src/github/bootstrap.ts — the one privileged provisioning step. Distinguishes created/verified/manual.
import type { Config } from "../config/schema.js";
import {
  ISSUE_TYPE_NAMES,
  PRIORITY_LABELS,
  PROJECT_FIELDS,
  STATUS_OPTIONS,
  allBootstrapLabels,
} from "../core/taxonomy.js";
import type { Logger } from "../observability/logger.js";
import type { GitHubClient } from "./client.js";
import { resolveCategories } from "./discussions.js";
import { CREATE_NUMBER_FIELD, CREATE_SELECT_FIELD } from "./mutations.js";
import { resolveProjectId } from "./nodeIds.js";
import { readProjectSchema } from "./projects.js";
import { ORG_ISSUE_TYPES } from "./queries.js";

export interface BootstrapReport {
  labels: { created: string[]; existed: string[] };
  issueTypes: { verified: string[]; missing: string[] };
  projectFields: { created: string[]; existed: string[] };
  discussions: { verified: string[]; missing: string[] };
  manualActions: string[];
}

const SELECT_COLORS = ["GRAY", "BLUE", "GREEN", "YELLOW", "ORANGE", "RED", "PURPLE", "PINK"];

/** Deterministic label color by category prefix (hex without '#'). */
function labelColor(name: string): string {
  if (name.startsWith("kind:")) return "1d76db"; // blue
  if (name.startsWith("status:")) return "fbca04"; // yellow
  if (name.startsWith("priority:")) return "d93f0b"; // orange-red
  if (name.startsWith("boule:")) return "5319e7"; // purple
  return "ededed"; // grey
}

const selectOptions = (names: readonly string[]) =>
  names.map((name, i) => ({
    name,
    color: SELECT_COLORS[i % SELECT_COLORS.length] ?? "GRAY",
    description: name,
  }));

export async function bootstrap(
  gh: GitHubClient,
  cfg: Config,
  log: Logger,
  opts: { dryRun: boolean } = { dryRun: false },
): Promise<BootstrapReport> {
  const [owner, name] = cfg.repo.split("/") as [string, string];
  const report: BootstrapReport = {
    labels: { created: [], existed: [] },
    issueTypes: { verified: [], missing: [] },
    projectFields: { created: [], existed: [] },
    discussions: { verified: [], missing: [] },
    manualActions: [],
  };

  // 1. Labels — idempotent create-or-skip via REST, with category colors.
  for (const labelName of allBootstrapLabels()) {
    try {
      await gh.withRest("read", (o) => o.issues.getLabel({ owner, repo: name, name: labelName }));
      report.labels.existed.push(labelName);
    } catch {
      if (!opts.dryRun) {
        await gh.withRest("write", (o) =>
          o.issues.createLabel({ owner, repo: name, name: labelName, color: labelColor(labelName) }),
        );
      }
      report.labels.created.push(labelName);
    }
  }

  // 2. Issue types — org-level, NOT API-creatable here; verify and report any missing.
  await verifyIssueTypes(gh, owner, report);

  // 3. Discussion categories — verify only (cannot be created via API).
  await verifyCategories(gh, owner, name, cfg, report);

  // 4. Projects v2 fields — created via API when a board is configured.
  if (cfg.projectNumber) {
    await ensureProjectFields(gh, owner, cfg.projectNumber, opts.dryRun, report);
  } else {
    report.manualActions.push("No projectNumber configured — skipped Projects v2 field bootstrap.");
  }

  log.info({ report }, "bootstrap complete");
  return report;
}

async function verifyIssueTypes(gh: GitHubClient, owner: string, report: BootstrapReport): Promise<void> {
  let present = new Set<string>();
  try {
    const data = await gh.graphql<{
      organization: { issueTypes: { nodes: { name: string }[] } } | null;
    }>("read", ORG_ISSUE_TYPES, { org: owner });
    present = new Set((data.organization?.issueTypes.nodes ?? []).map((n) => n.name));
  } catch {
    /* user-owned repo or no org access — types unavailable; fall back to kind labels */
  }
  for (const typeName of Object.values(ISSUE_TYPE_NAMES)) {
    if (present.has(typeName)) report.issueTypes.verified.push(typeName);
    else report.issueTypes.missing.push(typeName);
  }
  if (report.issueTypes.missing.length) {
    report.manualActions.push(
      `Create org Issue Types in Settings → Issue types: ${report.issueTypes.missing.join(", ")} (Boule falls back to kind:* labels until then).`,
    );
  }
}

async function verifyCategories(
  gh: GitHubClient,
  owner: string,
  name: string,
  cfg: Config,
  report: BootstrapReport,
): Promise<void> {
  let categories: { name: string }[] = [];
  try {
    categories = (await resolveCategories(gh, owner, name)).categories;
  } catch {
    report.manualActions.push("Enable Discussions on the repo (Settings → Features → Discussions).");
  }
  for (const wanted of Object.values(cfg.discussions)) {
    if (categories.some((c) => c.name === wanted)) report.discussions.verified.push(wanted);
    else {
      report.discussions.missing.push(wanted);
      report.manualActions.push(`Create Discussion category "${wanted}" (Settings → Discussions).`);
    }
  }
}

async function ensureProjectFields(
  gh: GitHubClient,
  owner: string,
  projectNumber: number,
  dryRun: boolean,
  report: BootstrapReport,
): Promise<void> {
  const projectId = await resolveProjectId(gh, owner, projectNumber);
  const existing = await readProjectSchema(gh, projectId);

  const selects: Array<{ name: string; options: readonly string[] }> = [
    { name: PROJECT_FIELDS.status, options: STATUS_OPTIONS },
    { name: PROJECT_FIELDS.kind, options: Object.values(ISSUE_TYPE_NAMES) },
    { name: PROJECT_FIELDS.priority, options: PRIORITY_LABELS.map((l) => l.replace("priority:", "")) },
  ];
  const numbers = [PROJECT_FIELDS.rice, PROJECT_FIELDS.wsjf];

  for (const f of selects) {
    if (existing[f.name]) {
      report.projectFields.existed.push(f.name);
      continue;
    }
    if (!dryRun) {
      await gh.graphql("write", CREATE_SELECT_FIELD, {
        projectId,
        name: f.name,
        options: selectOptions(f.options),
      });
    }
    report.projectFields.created.push(f.name);
  }

  for (const fieldName of numbers) {
    if (existing[fieldName]) {
      report.projectFields.existed.push(fieldName);
      continue;
    }
    if (!dryRun) {
      await gh.graphql("write", CREATE_NUMBER_FIELD, { projectId, name: fieldName });
    }
    report.projectFields.created.push(fieldName);
  }

  report.manualActions.push(
    `Create the "${PROJECT_FIELDS.iteration}" iteration field in the Projects UI if you use iterations.`,
  );
}
