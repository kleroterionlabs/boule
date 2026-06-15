#!/usr/bin/env node
// Regenerates src/agents/prompts.generated.ts from the human-editable src/agents/prompts/*.md
// files (YAML front-matter + Markdown body). Run via `npm run gen:prompts` (also a prebuild step).
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const promptsDir = join(here, "..", "src", "agents", "prompts");
const outFile = join(here, "..", "src", "agents", "prompts.generated.ts");

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;

const specs = {};
for (const file of readdirSync(promptsDir)
  .filter((f) => f.endsWith(".md"))
  .sort()) {
  const raw = readFileSync(join(promptsDir, file), "utf8");
  const m = raw.match(FRONTMATTER);
  if (!m) {
    console.warn(`skip ${file}: no front-matter`);
    continue;
  }
  const fm = parseYaml(m[1]) ?? {};
  const systemPrompt = raw.slice(m[0].length).trim();
  const key = fm.key ?? file.replace(/\.md$/, "");
  specs[key] = {
    key,
    name: fm.name ?? key,
    description: fm.description ?? "",
    model: fm.model ?? "claude-sonnet-4-6",
    allowedTools: Array.isArray(fm.allowedTools) ? fm.allowedTools.map(String) : [],
    systemPrompt,
  };
}

const header = `// AUTO-GENERATED from src/agents/prompts/*.md by scripts/gen-prompts.mjs — do not edit by hand.
// Run \`npm run gen:prompts\` to regenerate after editing a prompt.

export type AgentModelId = 'claude-opus-4-8' | 'claude-sonnet-4-6' | 'claude-haiku-4-5';

export interface AgentSpec {
  key: string;
  name: string;
  description: string;
  model: AgentModelId;
  allowedTools: string[];
  systemPrompt: string;
}

export const AGENT_SPECS: Record<string, AgentSpec> = `;

writeFileSync(outFile, `${header + JSON.stringify(specs, null, 2)};\n`, "utf8");
console.log(`wrote ${outFile} (${Object.keys(specs).length} agents: ${Object.keys(specs).join(", ")})`);
