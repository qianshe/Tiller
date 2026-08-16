import type { IssueError, IssueErrorKind } from "@tiller/shared";

export class GithubIssueProviderError extends Error {
  readonly kind: IssueErrorKind;
  readonly status?: number;
  readonly retryAfterSeconds?: number;

  constructor(
    kind: IssueErrorKind,
    message: string,
    options?: { status?: number; retryAfterSeconds?: number },
  ) {
    super(message);
    this.name = "GithubIssueProviderError";
    this.kind = kind;
    this.status = options?.status;
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }
}

export function toIssueError(error: unknown): IssueError {
  if (error instanceof GithubIssueProviderError) {
    return {
      kind: error.kind,
      message: error.message,
      ...(error.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: error.retryAfterSeconds }),
    };
  }
  return {
    kind: "network",
    message: error instanceof Error ? error.message : "GitHub Issue request failed",
  };
}
