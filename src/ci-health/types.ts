// src/ci-health/types.ts — domain types for the CI-health feature slice.

/**
 * Lean reference to a GitHub repository.
 *
 * The mapped, domain-facing shape used throughout CI-health; carries only the
 * identifiers downstream consumers need rather than the full Repos API payload.
 */
export interface RepoRef {
  /** Login of the repository owner. */
  owner: string;
  /** Bare repository name. */
  name: string;
  /** `owner/repo` full name. */
  fullName: string;
}

/**
 * Raised when fetching CI-health data from GitHub fails.
 *
 * Carries the originating HTTP {@link CiHealthFetchError.status status} (when the
 * failure came from an HTTP response) so callers can branch on it.
 */
export class CiHealthFetchError extends Error {
  override name = "CiHealthFetchError";
  constructor(
    message: string,
    /** HTTP status code of the failing response, or `undefined` for non-HTTP failures. */
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

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
