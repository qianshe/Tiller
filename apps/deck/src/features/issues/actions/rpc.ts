import type {
  IssueDetail,
  IssueError,
  IssueListState,
  IssueSummary,
} from "@tiller/shared";
import type { DeckRpcClient, DispatchToHelm } from "../../helm-connection";

const DEFAULT_ISSUE_PAGE_SIZE = 30;

export type IssueListResponse = {
  ok: boolean;
  projectId: string;
  issues: IssueSummary[];
  nextCursor?: string;
  error?: IssueError;
  message: string;
};

export type IssueDetailResponse = {
  ok: boolean;
  projectId: string;
  issue?: IssueDetail;
  error?: IssueError;
  message: string;
};

type IssueListRequest = {
  projectId: string;
  state: IssueListState;
  cursor?: string;
  sourceHelmKey: string;
};

type IssueDetailRequest = {
  projectId: string;
  issueNumber: string;
  sourceHelmKey: string;
};

export async function requestIssueList(
  client: DeckRpcClient,
  dispatch: DispatchToHelm,
  input: IssueListRequest,
): Promise<IssueListResponse> {
  try {
    const response = await dispatch(
      client,
      "issue/list",
      {
        projectId: input.projectId,
        state: input.state,
        ...(input.cursor ? { cursor: input.cursor } : {}),
        limit: DEFAULT_ISSUE_PAGE_SIZE,
      },
      { sourceHelmKey: input.sourceHelmKey },
    );
    return normalizeIssueListResponse(response, input.projectId);
  } catch (error) {
    return issueListRequestFailure(input.projectId, error);
  }
}

export async function requestIssueDetail(
  client: DeckRpcClient,
  dispatch: DispatchToHelm,
  input: IssueDetailRequest,
): Promise<IssueDetailResponse> {
  try {
    const response = await dispatch(
      client,
      "issue/get",
      {
        projectId: input.projectId,
        issueNumber: input.issueNumber,
      },
      { sourceHelmKey: input.sourceHelmKey },
    );
    return normalizeIssueDetailResponse(response, input.projectId);
  } catch (error) {
    return issueDetailRequestFailure(input.projectId, error);
  }
}

function normalizeIssueListResponse(value: unknown, fallbackProjectId: string): IssueListResponse {
  if (!isRecord(value) || typeof value.ok !== "boolean" || !Array.isArray(value.issues)) {
    return invalidIssueListResponse(fallbackProjectId);
  }
  const projectId = typeof value.projectId === "string" ? value.projectId : fallbackProjectId;
  const message = typeof value.message === "string" ? value.message : "Issue list response is invalid";
  const error = normalizeIssueError(value.error);
  if (!value.issues.every(isIssueSummary) || (value.ok && error)) {
    return invalidIssueListResponse(projectId);
  }
  if (!value.ok && !error) {
    return invalidIssueListResponse(projectId);
  }
  return {
    ok: value.ok,
    projectId,
    issues: value.issues,
    ...(typeof value.nextCursor === "string" ? { nextCursor: value.nextCursor } : {}),
    ...(error ? { error } : {}),
    message,
  };
}

function normalizeIssueDetailResponse(value: unknown, fallbackProjectId: string): IssueDetailResponse {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return invalidIssueDetailResponse(fallbackProjectId);
  }
  const projectId = typeof value.projectId === "string" ? value.projectId : fallbackProjectId;
  const message = typeof value.message === "string" ? value.message : "Issue detail response is invalid";
  const error = normalizeIssueError(value.error);
  if ((value.ok && !isIssueDetail(value.issue)) || (value.ok && error) || (!value.ok && !error)) {
    return invalidIssueDetailResponse(projectId);
  }
  return {
    ok: value.ok,
    projectId,
    ...(isIssueDetail(value.issue) ? { issue: value.issue } : {}),
    ...(error ? { error } : {}),
    message,
  };
}

function issueListRequestFailure(projectId: string, error: unknown): IssueListResponse {
  const issueError = createTransportIssueError(error);
  return {
    ok: false,
    projectId,
    issues: [],
    error: issueError,
    message: issueError.message,
  };
}

function issueDetailRequestFailure(projectId: string, error: unknown): IssueDetailResponse {
  const issueError = createTransportIssueError(error);
  return {
    ok: false,
    projectId,
    error: issueError,
    message: issueError.message,
  };
}

function invalidIssueListResponse(projectId: string): IssueListResponse {
  const error: IssueError = {
    kind: "invalid-response",
    message: "Helm returned an invalid Issue list response",
  };
  return { ok: false, projectId, issues: [], error, message: error.message };
}

function invalidIssueDetailResponse(projectId: string): IssueDetailResponse {
  const error: IssueError = {
    kind: "invalid-response",
    message: "Helm returned an invalid Issue detail response",
  };
  return { ok: false, projectId, error, message: error.message };
}

function createTransportIssueError(error: unknown): IssueError {
  return {
    kind: "network",
    message: error instanceof Error && error.message
      ? error.message
      : "Issue request could not be completed",
  };
}

function normalizeIssueError(value: unknown): IssueError | undefined {
  if (!isRecord(value) || !isIssueErrorKind(value.kind) || typeof value.message !== "string") {
    return undefined;
  }
  return {
    kind: value.kind,
    message: value.message,
    ...(typeof value.retryAfterSeconds === "number" && Number.isInteger(value.retryAfterSeconds)
      ? { retryAfterSeconds: value.retryAfterSeconds }
      : {}),
  };
}

function isIssueSummary(value: unknown): value is IssueSummary {
  return isRecord(value)
    && isExternalIssueRef(value.ref)
    && typeof value.title === "string"
    && (value.state === "open" || value.state === "closed")
    && Array.isArray(value.assignees)
    && value.assignees.every(isIssueActor)
    && Array.isArray(value.labels)
    && value.labels.every(isIssueLabel)
    && typeof value.url === "string"
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string"
    && (value.author === undefined || isIssueActor(value.author));
}

function isIssueDetail(value: unknown): value is IssueDetail {
  if (!isIssueSummary(value)) {
    return false;
  }
  const detail = value as IssueSummary & { body?: unknown };
  return detail.body === undefined || typeof detail.body === "string";
}

function isExternalIssueRef(value: unknown) {
  return isRecord(value)
    && value.provider === "github"
    && typeof value.remoteKey === "string"
    && typeof value.issueId === "string"
    && (value.issueNumber === undefined || typeof value.issueNumber === "string");
}

function isIssueActor(value: unknown) {
  return isRecord(value) && typeof value.id === "string" && typeof value.displayName === "string";
}

function isIssueLabel(value: unknown) {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && (value.color === undefined || typeof value.color === "string");
}

function isIssueErrorKind(value: unknown): value is IssueError["kind"] {
  return value === "project-not-found"
    || value === "not-configured"
    || value === "missing-token"
    || value === "unauthorized"
    || value === "forbidden"
    || value === "not-found"
    || value === "rate-limited"
    || value === "unavailable"
    || value === "timeout"
    || value === "network"
    || value === "invalid-response";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
