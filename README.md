# Boule

> **Autonomous, CLI-only, GitHub-native AI product & program management — built on the Claude Agent SDK.**

Boule is a command-line tool that turns a one-line idea into a fully-formed, tracked software initiative. It runs a fleet of specialized Claude agents that produce **product designs**, **requirements**, **competitive analysis**, and **gap analysis**, then files and grooms the work as **GitHub Issues + Projects v2**, collaborating and reporting through **GitHub Discussions**.

There is no database and no web app. **GitHub _is_ the system of record and the UI:**

| Artifact | Lives as |
| --- | --- |
| Product designs, requirements, competitors, gaps, epics/features/tasks | **typed GitHub Issues** (labelled, with stable `boule-id` front-matter) |
| Planning & tracking | **GitHub Projects v2** (Status / Kind / Priority / RICE / Iteration fields) |
| Agent-to-agent collaboration | **GitHub Discussions** (handoffs, design review) |
| The daily status "dashboard" | a **GitHub Discussion** post, one per day |

The full architecture, methodology, GitHub schema, agent roster, and a dogfooded design-review appendix are in **[`docs/design.md`](docs/design.md)**.

---

## Quickstart

```bash
npm install        # install deps and build prompts
npm run build      # compile to dist/  (bin: dist/bin.js)

export ANTHROPIC_API_KEY=...      # or an existing `claude login`
export GITHUB_TOKEN=...           # fine-grained PAT or GitHub App token

node dist/bin.js init --repo owner/repo   # writes .boule/config.yaml
node dist/bin.js doctor                    # validate creds + config
node dist/bin.js bootstrap                 # create labels / issue types / project fields / discussion categories

# Generate the initiative
node dist/bin.js design "A CLI that turns prod alerts into runbooks"
node dist/bin.js requirements <design#>    # ISO/IEC/IEEE 29148 + Given/When/Then sub-issues
node dist/bin.js compete "incident response tooling"
node dist/bin.js gap <design#>
node dist/bin.js plan <design#>            # decompose → Epics/Features/Tasks, populate the board
node dist/bin.js daily                     # post today's status Discussion
```

Published to npm as **`@kleroterion/cli`** (binary: `boule`). Once installed, `npx @kleroterion/cli <command>`, or `npm i -g @kleroterion/cli` then `boule <command>`.

## Commands

| Command | What it does |
| --- | --- |
| `boule init` | Scaffold `.boule/config.yaml` |
| `boule doctor` | Validate environment, credentials, and config |
| `boule bootstrap` | Create labels, issue types, Project fields & Discussion categories (idempotent) |
| `boule design [idea]` | Produce a Product Design (PRD) issue (`--brief <file>` / `-` for stdin) |
| `boule requirements <design>` | Derive Requirement sub-issues with numeric NFRs + acceptance criteria |
| `boule compete <space>` | Competitive analysis → Competitor issues + feature matrix (`--for <design>`) |
| `boule gap [design]` | Gap analysis (desired vs current) → prioritized Gap issues |
| `boule plan <design>` | Decompose into Epics → Features → Tasks and populate the board |
| `boule sync` | Reconcile issues ↔ board |
| `boule triage` | Groom the backlog (great for a scheduled CI run) |
| `boule status` (alias `board`) | Read-only board summary |
| `boule daily` | Post the daily status standup Discussion |

**Global flags:** `--repo`, `--project`, `--model`, `--effort`, `--budget <usd>`, `--max-turns`, `--dry-run`, `--json`, `--config`, `-v`.

## How it works

```
CLI (commander)
   └─ Orchestrator  ── query()  [claude-opus-4-8]
        ├─ Repo Scout          [haiku]   read-only context gathering
        ├─ Product Designer    [opus]    PRD authoring
        ├─ Requirements Eng.   [sonnet]  ISO 29148 + Gherkin
        ├─ Competitive Analyst [sonnet]  feature matrix + positioning
        ├─ Gap Analyst         [sonnet]  desired-vs-current backlog
        ├─ Critic / Reviewer   [opus]    verifiability gate
        └─ Issue/Project Mgr   [sonnet]  the ONLY writer to GitHub
                    │
            in-process MCP tool layer  ←  canUseTool gate + PreToolUse audit hook
                    │
            rate-limited Octokit  →  GitHub Issues / Projects v2 / Discussions
```

Agents never touch Octokit directly — they call gated in-process MCP tools (`mcp__github__gh_*`). Only the Issue/Project Manager holds write tools.

## Autonomous, but safe

Boule acts without per-action approval, so the guardrails are built in:

- **Idempotent upserts** — a stable `boule-id` + content hash means re-runs update in place instead of spamming duplicates.
- **`--dry-run`** plans every write and commits nothing (enforced twice: at the `canUseTool` gate and inside each tool).
- **Blast-radius cap** — `budgets.maxGithubWrites` halts a runaway run; **`--budget <usd>`** is a hard, SDK-enforced cost ceiling.
- **Write scoping** — only the configured repo/project; every artifact is tagged `agent/boule`.
- **Audit trail** — a `PreToolUse` hook logs every tool call with run-id, independent of the permission gate.
- **Prompt-injection resistance** — untrusted web/issue/repo content is data; it cannot widen the tool allowlist.

## Development

```bash
npm run gen:prompts   # regenerate src/agents/prompts.generated.ts from src/agents/prompts/*.md
npm run typecheck     # tsc --noEmit
npm run lint          # biome
npm test              # vitest (offline; msw blocks real network)
npm run build         # tsup → dist/
```

Agent system prompts are authored as Markdown in [`src/agents/prompts/`](src/agents/prompts/) and compiled into a typed module by `gen:prompts` (a `prebuild` step).

## License

MIT © Bill Schumacher
