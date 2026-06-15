import type { Config } from "../config/schema.js";
import { PROJECT_FIELDS, STATUS_OPTIONS, allBootstrapLabels } from "../core/taxonomy.js";
import type { Logger } from "../observability/logger.js";
// src/github/bootstrap.ts — the one privileged provisioning step. Distinguishes created/verified/manual.
import type { GitHubClient } from "./client.js";
import { resolveCategories } from "./discussions.js";

export interface BootstrapReport {
  labels: { created: string[]; existed: string[] };
  issueTypes: { verified: string[]; missing: string[] };
  projectFields: { created: string[] };
  discussions: { verified: string[]; missing: string[] };
  manualActions: string[];
}

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
    projectFields: { created: [] },
    discussions: { verified: [], missing: [] },
    manualActions: [],
  };

  // 1. Labels — idempotent create-or-skip via REST.
  for (const labelName of allBootstrapLabels()) {
    try {
      await gh.withRest("read", (o) => o.issues.getLabel({ owner, repo: name, name: labelName }));
      report.labels.existed.push(labelName);
    } catch {
      if (!opts.dryRun) {
        await gh.withRest("write", (o) =>
          o.issues.createLabel({ owner, repo: name, name: labelName, color: "ededed" }),
        );
      }
      report.labels.created.push(labelName);
    }
  }

  // 2. Discussion categories — verify only (cannot create via API).
  const { categories } = await resolveCategories(gh, owner, name);
  for (const wanted of Object.values(cfg.discussions)) {
    if (categories.some((c) => c.name === wanted)) report.discussions.verified.push(wanted);
    else {
      report.discussions.missing.push(wanted);
      report.manualActions.push(`Create Discussion category "${wanted}" in repo settings.`);
    }
  }

  // 3. Iteration field — cannot be created via API.
  report.manualActions.push(
    `Create the "${PROJECT_FIELDS.iteration}" iteration field in the Projects UI (API limitation).`,
  );

  // TODO: verify org issue types (organization.issueTypes) and create single-select Project fields
  //       (Status with STATUS_OPTIONS, Kind, Priority, RICE/WSJF numbers) via createProjectV2Field.
  log.info({ report }, "bootstrap complete");
  return report;
}
