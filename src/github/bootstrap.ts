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
import {
  CREATE_ISSUE_TYPE,
  CREATE_NUMBER_FIELD,
  CREATE_PROJECT_V2,
  CREATE_SELECT_FIELD,
  LINK_PROJECT_V2,
} from "./mutations.js";
import { resolveProjectId, resolveRepoId } from "./nodeIds.js";
import { readProjectSchema } from "./projects.js";
import { ORG_ISSUE_TYPES, OWNER_ID } from "./queries.js";

export interface BootstrapReport {
  labels: { created: string[]; existed: string[] };
  issueTypes: { created: string[]; verified: string[]; missing: string[] };
  project?: { number: number; url: string; created: boolean };
  projectFields: { created: string[]; existed: string[] };
  discussions: { verified: string[]; missing: string[] };
  manualActions: string[];
}

export interface BootstrapOptions {
  dryRun: boolean;
  /** Create a new Projects v2 board with this title (when no projectNumber is configured). */
  createProjectTitle?: string;
}

const SELECT_COLORS = ["GRAY", "BLUE", "GREEN", "YELLOW", "ORANGE", "RED", "PURPLE", "PINK"];

/** Issue-type colors (IssueTypeColor enum). Feature/Task exist by default; these are Boule's custom ones. */
const ISSUE_TYPE_COLORS: Record<string, string> = {
  Design: "BLUE",
  Requirement: "GREEN",
  Competitor: "ORANGE",
  Gap: "RED",
  Epic: "PURPLE",
  Feature: "GRAY",
  Task: "GRAY",
};

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
  opts: BootstrapOptions = { dryRun: false },
): Promise<BootstrapReport> {
  const [owner, name] = cfg.repo.split("/") as [string, string];
  const report: BootstrapReport = {
    labels: { created: [], existed: [] },
    issueTypes: { created: [], verified: [], missing: [] },
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

  // 2. Issue types — org-level; create Boule's custom types if the App has org-admin access.
  await ensureIssueTypes(gh, owner, opts.dryRun, report);

  // 3. Discussion categories — verify only (cannot be created via API).
  await verifyCategories(gh, owner, name, cfg, report);

  // 4. Projects v2 board + fields.
  let projectId: string | undefined;
  if (cfg.projectNumber) {
    projectId = await resolveProjectId(gh, owner, cfg.projectNumber);
  } else if (opts.createProjectTitle && !opts.dryRun) {
    projectId = await createProject(gh, owner, name, opts.createProjectTitle, report);
  } else if (opts.createProjectTitle) {
    report.manualActions.push(`Would create Projects v2 board "${opts.createProjectTitle}" (dry-run).`);
  } else {
    report.manualActions.push(
      "No projectNumber configured — set one or pass --create-project to provision a board.",
    );
  }
  if (projectId) await ensureProjectFields(gh, projectId, opts.dryRun, report);

  log.info({ report }, "bootstrap complete");
  return report;
}

async function ensureIssueTypes(
  gh: GitHubClient,
  owner: string,
  dryRun: boolean,
  report: BootstrapReport,
): Promise<void> {
  let ownerId: string | undefined;
  let present = new Set<string>();
  try {
    const data = await gh.graphql<{
      organization: { id: string; issueTypes: { nodes: { name: string }[] } } | null;
    }>("read", ORG_ISSUE_TYPES, { org: owner });
    ownerId = data.organization?.id;
    present = new Set((data.organization?.issueTypes.nodes ?? []).map((n) => n.name));
  } catch {
    /* user-owned repo or no org access — types unavailable */
  }

  let createError: string | undefined;
  for (const typeName of Object.values(ISSUE_TYPE_NAMES)) {
    if (present.has(typeName)) {
      report.issueTypes.verified.push(typeName);
      continue;
    }
    if (!ownerId || dryRun) {
      report.issueTypes[ownerId && dryRun ? "created" : "missing"].push(typeName);
      continue;
    }
    try {
      await gh.graphql("write", CREATE_ISSUE_TYPE, {
        ownerId,
        name: typeName,
        color: ISSUE_TYPE_COLORS[typeName] ?? "GRAY",
        description: `Boule ${typeName} artifact`,
      });
      report.issueTypes.created.push(typeName);
    } catch (e) {
      report.issueTypes.missing.push(typeName);
      createError ??= /admin:org|INSUFFICIENT_SCOPES|not accessible/i.test(String(e))
        ? "the App needs Organization administration (admin:org) write access"
        : String(e).slice(0, 140);
    }
  }

  if (report.issueTypes.missing.length) {
    const why = createError
      ? `Couldn't create issue types — ${createError}.`
      : !ownerId
        ? "Issue types are org-only and unavailable for this owner."
        : "";
    report.manualActions.push(
      `${why} Create [${report.issueTypes.missing.join(", ")}] in org Settings → Issue types, or grant the App admin:org so \`boule bootstrap\` self-provisions them. Until then Boule uses kind:* labels.`,
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

/** Create a new Projects v2 board owned by the repo's owner and link it to the repo. */
async function createProject(
  gh: GitHubClient,
  owner: string,
  name: string,
  title: string,
  report: BootstrapReport,
): Promise<string> {
  const ownerData = await gh.graphql<{ repositoryOwner: { id: string } | null }>("read", OWNER_ID, {
    login: owner,
  });
  const ownerId = ownerData.repositoryOwner?.id;
  if (!ownerId) throw new Error(`could not resolve owner id for "${owner}"`);

  const created = await gh.graphql<{
    createProjectV2: { projectV2: { id: string; number: number; url: string } };
  }>("write", CREATE_PROJECT_V2, { ownerId, title });
  const { id, number, url } = created.createProjectV2.projectV2;

  const repositoryId = await resolveRepoId(gh, owner, name);
  await gh.graphql("write", LINK_PROJECT_V2, { projectId: id, repositoryId });

  report.project = { number, url, created: true };
  report.manualActions.push(
    `Created board #${number} — add \`projectNumber: ${number}\` to .boule/config.yaml.`,
  );
  return id;
}

async function ensureProjectFields(
  gh: GitHubClient,
  projectId: string,
  dryRun: boolean,
  report: BootstrapReport,
): Promise<void> {
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
