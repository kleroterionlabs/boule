// src/cli/commands/resolve.ts — answer an artifact's Open Questions. Interactive by default; or
// `--set OQ2=...` for scripting; or `--from-comments` to ingest answers left by write/admin users.
import { createInterface } from "node:readline/promises";
import type { Command } from "commander";
import { resolveAuth } from "../../config/auth.js";
import { type CliFlags, loadConfig } from "../../config/load.js";
import { createGitHubClient } from "../../github/client.js";
import { findByBouleId } from "../../github/issues.js";
import { gatherCommentAnswers, persistResolutions } from "../../github/oqResolution.js";
import { createLogger } from "../../observability/logger.js";
import { type Resolution, parseOpenQuestions } from "../../quality/openQuestions.js";
import { globals } from "./_shared.js";

const collect = (v: string, acc: string[]): string[] => [...acc, v];

export function registerResolve(program: Command): void {
  program
    .command("resolve <bouleId>")
    .description(
      "Answer an artifact's Open Questions and record the decisions in the issue. Interactive by " +
        "default; --set for scripting; --from-comments ingests answers left by write/admin collaborators.",
    )
    .option(
      "--set <oq=answer>",
      "answer one question non-interactively (repeatable), e.g. --set OQ2=...",
      collect,
      [],
    )
    .option("--from-comments", "ingest OQ answers from issue comments by write/admin collaborators", false)
    .action(async (bouleId: string, local: { set: string[]; fromComments?: boolean }, cmd: Command) => {
      const global = globals(cmd);
      const cfg = loadConfig({ cwd: process.cwd(), env: process.env, cli: global as CliFlags });
      const [owner, name] = cfg.repo.split("/") as [string, string];
      const log = createLogger(cfg, `resolve-${bouleId}`);
      const gh = await createGitHubClient(resolveAuth(process.env), log);

      const json = Boolean(global.json);
      const emit = (obj: unknown, text: string, exit?: number): void => {
        if (json) process.stdout.write(`${JSON.stringify(obj)}\n`);
        else (exit ? process.stderr : process.stdout).write(`${text}\n`);
        if (exit) process.exitCode = exit;
      };

      const issue = await findByBouleId(gh, owner, name, bouleId);
      if (!issue) {
        emit({ ok: false, reason: "no-issue", bouleId }, `No issue found for boule-id "${bouleId}".`, 2);
        return;
      }
      const open = parseOpenQuestions(issue.body);
      const openIds = new Set(open.map((q) => q.id));
      if (open.length === 0) {
        emit(
          { ok: true, reason: "no-open-questions", number: issue.number, applied: [] },
          `#${issue.number} has no unresolved Open Questions.`,
        );
        return;
      }

      // Explicit sources can be combined (later answers win via dedupeById); otherwise prompt.
      const explicit = local.fromComments || local.set.length > 0;
      let resolutions: Resolution[] = [];
      if (local.fromComments)
        resolutions.push(...(await fromComments(gh, owner, name, issue.number, openIds)));
      if (local.set.length > 0) resolutions.push(...fromSet(local.set, openIds));
      if (!explicit) {
        if (!process.stdin.isTTY) {
          emit(
            { ok: false, reason: "no-input" },
            "No answers provided and stdin is not interactive. Use --set OQ#=answer or --from-comments.",
            2,
          );
          return;
        }
        resolutions = await interactive(open);
      }

      resolutions = dedupeById(resolutions);
      if (resolutions.length === 0) {
        // An explicit but fully-skipped/unauthorized/typo'd request is a failure, not a silent success.
        emit(
          { ok: !explicit, reason: "no-answers", applied: [] },
          "No answers to apply.",
          explicit ? 2 : undefined,
        );
        return;
      }

      const today = new Date().toISOString().slice(0, 10);
      const result = await persistResolutions(gh, {
        owner,
        name,
        number: issue.number,
        url: issue.url,
        body: issue.body,
        resolutions,
        today,
        dryRun: cfg.flags.dryRun,
      });

      if (json) {
        process.stdout.write(`${JSON.stringify({ ...result, ok: true, dryRun: cfg.flags.dryRun })}\n`);
        return;
      }
      const verb = cfg.flags.dryRun ? "Would resolve" : "Resolved";
      const lines = [`${verb} ${result.applied.length} question(s) on #${issue.number} — ${issue.url}`];
      for (const r of result.applied) lines.push(`  ${r.id}: ${r.answer}`);
      if (!cfg.flags.dryRun) lines.push("Run `boule sync` to reconcile any downstream artifacts.");
      process.stdout.write(`${lines.join("\n")}\n`);
    });
}

async function interactive(open: { id: string; text: string }[]): Promise<Resolution[]> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const out: Resolution[] = [];
  try {
    process.stdout.write("Answer each open question (blank to skip):\n");
    for (const q of open) {
      const ans = (await rl.question(`\n${q.id}  ${q.text}\n> `)).trim();
      if (ans) out.push({ id: q.id, answer: ans, source: "interactive" });
    }
  } finally {
    rl.close();
  }
  return out;
}

function fromSet(pairs: string[], openIds: Set<string>): Resolution[] {
  const out: Resolution[] = [];
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq === -1) {
      process.stderr.write(`Ignoring malformed --set "${pair}" (expected OQ#=answer).\n`);
      continue;
    }
    const id = pair.slice(0, eq).trim().toUpperCase();
    const answer = pair.slice(eq + 1).trim();
    if (!openIds.has(id)) {
      process.stderr.write(`Ignoring "${id}" — not an open question on this issue.\n`);
      continue;
    }
    if (answer) out.push({ id, answer, source: "explicit" });
  }
  return out;
}

async function fromComments(
  gh: Parameters<typeof gatherCommentAnswers>[0],
  owner: string,
  name: string,
  issueNumber: number,
  openIds: Set<string>,
): Promise<Resolution[]> {
  const answers = await gatherCommentAnswers(gh, owner, name, issueNumber);
  const out: Resolution[] = [];
  for (const a of answers) {
    if (!openIds.has(a.id)) continue;
    if (!a.authorized) {
      process.stderr.write(
        `Skipping ${a.id} from @${a.by} (permission "${a.permission}" — needs write/admin).\n`,
      );
      continue;
    }
    out.push({ id: a.id, answer: a.answer, by: a.by, source: "comment" });
  }
  return out;
}

/** Last answer wins per OQ id (a later comment / later --set overrides an earlier one). */
function dedupeById(resolutions: Resolution[]): Resolution[] {
  const byId = new Map<string, Resolution>();
  for (const r of resolutions) byId.set(r.id, r);
  return [...byId.values()];
}
