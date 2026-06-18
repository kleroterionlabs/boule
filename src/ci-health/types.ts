// src/ci-health/types.ts — domain types for the CI-health feature slice.

/**
 * Internal representation of a GitHub Actions workflow run.
 *
 * This is the mapped, domain-facing shape: timestamps are `Date` objects rather
 * than the raw ISO strings returned by the Actions API.
 */
export interface WorkflowRun {
  /** Numeric run id assigned by GitHub. */
  id: number;
  /** Display name of the workflow run. */
  name: string;
  /** `owner/repo` the run belongs to. */
  repoFullName: string;
  /** Lifecycle status (e.g. `queued`, `in_progress`, `completed`). */
  status: string | null;
  /** Outcome once completed (e.g. `success`, `failure`); `null` while running. */
  conclusion: string | null;
  /** Commit SHA the run was triggered against. */
  headSha: string;
  /** Branch the run was triggered against. */
  headBranch: string | null;
  /** When the run was created. */
  createdAt: Date;
  /** When the run was last updated. */
  updatedAt: Date;
  /** Link to the run on github.com. */
  htmlUrl: string;
}
