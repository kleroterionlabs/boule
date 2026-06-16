// src/orchestrator/resume.ts — build the prompt for a resumed run. The SDK restores the prior
// conversation via options.resume, so this just re-anchors the agent on finishing the work; Boule's
// idempotent upserts make any already-written artifact a no-op on the second pass.
export function resumePrompt(workflow: string, originalPrompt: string): string {
  return [
    `RESUMING a previous \`${workflow}\` run — your prior conversation and progress are restored.`,
    "Do NOT start over. Review what you already wrote, then complete only the artifacts that are not",
    "yet persisted. Re-emitting an unchanged artifact is a safe no-op (idempotent on boule-id), so when",
    "in doubt, re-attempt the write rather than skip it. Stop once every planned artifact exists.",
    "",
    "The original instruction was:",
    originalPrompt,
  ].join("\n");
}
