import type {
  ExternalIssueRef,
  IssueDetail,
  IssueListState,
  IssueProjectBinding,
  IssueSummary,
} from "@tiller/shared";
import { GithubIssueProviderError } from "./errors";

const GITHUB_API_ORIGIN = "https://api.github.com";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

type GithubFetch = typeof fetch;

type GithubIssuePayload = {
  id?: unknown;
  number?: unknown;
  title?: unknown;
  state?: unknown;
  user?: unknown;
  assignees?: unknown;
  labels?: unknown;
  html_url?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  body?: unknown;
  pull_request?: unknown;
};

export type GithubIssueClient = {
  list(input: {
    binding: IssueProjectBinding;
    state?: IssueListState;
    limit?: number;
    cursor?: string;
  }): Promise<{ issues: IssueSummary[]; nextCursor?: string }>;
  get(input: {
    binding: IssueProjectBinding;
    issueNumber: string;
  }): Promise<IssueDetail>;
};

export type GithubIssueClientOptions = {
  token?: string;
  fetchFn?: GithubFetch;
  timeoutMs?: number;
};

export function resolveGithubToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const token = env.GITHUB_TOKEN?.trim() || env.GH_TOKEN?.trim();
  return token || undefined;
}

export function createGithubIssueClient(options: GithubIssueClientOptions = {}): GithubIssueClient {
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const token = options.token?.trim() || resolveGithubToken();

  async function request(path: string, searchParams?: URLSearchParams) {
    if (!token) {
      throw new GithubIssueProviderError(
        "missing-token",
        "GitHub token is not configured. Set GITHUB_TOKEN or GH_TOKEN in the Helm environment.",
      );
    }
    const url = new URL(path, GITHUB_API_ORIGIN);
    if (searchParams) {
      url.search = searchParams.toString();
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchFn(url, {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "Tiller",
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new GithubIssueProviderError("timeout", "GitHub Issue request timed out");
      }
      throw new GithubIssueProviderError(
        "network",
        error instanceof Error ? error.message : "GitHub Issue request failed",
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw resolveHttpError(response);
    }
    try {
      return { response, payload: (await response.json()) as unknown };
    } catch {
      throw new GithubIssueProviderError("invalid-response", "GitHub returned invalid JSON");
    }
  }

  return {
    async list({ binding, state = "open", limit = DEFAULT_PAGE_SIZE, cursor }) {
      const repository = resolveRepository(binding);
      const page = resolvePage(cursor);
      const pageSize = Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE_SIZE);
      const params = new URLSearchParams({
        state: state === "all" ? "all" : state,
        per_page: String(pageSize),
        page: String(page),
        sort: "updated",
        direction: "desc",
      });
      const { response, payload } = await request(
        `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/issues`,
        params,
      );
      if (!Array.isArray(payload)) {
        throw new GithubIssueProviderError("invalid-response", "GitHub Issue list has an invalid shape");
      }
      const issues = payload
        .filter((item): item is GithubIssuePayload => isRecord(item) && item.pull_request === undefined)
        .map((item) => mapIssue(item, binding, false));
      return { issues, nextCursor: resolveNextCursor(response.headers.get("link")) };
    },

    async get({ binding, issueNumber }) {
      const repository = resolveRepository(binding);
      const normalizedIssueNumber = resolveIssueNumber(issueNumber);
      const { payload } = await request(
        `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/issues/${normalizedIssueNumber}`,
      );
      if (!isRecord(payload) || payload.pull_request !== undefined) {
        throw new GithubIssueProviderError("not-found", "GitHub pull requests are not supported as Issues");
      }
      return mapIssue(payload, binding, true);
    },
  };
}

function resolveRepository(binding: IssueProjectBinding) {
  if (binding.provider !== "github") {
    throw new GithubIssueProviderError("not-configured", "Project is not bound to GitHub Issues");
  }
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/u.exec(binding.remoteKey.trim());
  if (!match) {
    throw new GithubIssueProviderError("not-configured", "GitHub repository must use owner/repo format");
  }
  return { owner: match[1], name: match[2] };
}

function resolvePage(cursor: string | undefined) {
  if (!cursor) {
    return 1;
  }
  const page = Number.parseInt(cursor, 10);
  if (!Number.isInteger(page) || page < 1 || String(page) !== cursor) {
    throw new GithubIssueProviderError("invalid-response", "Issue page cursor is invalid");
  }
  return page;
}

function resolveIssueNumber(issueNumber: string) {
  if (!/^\d+$/u.test(issueNumber)) {
    throw new GithubIssueProviderError("not-configured", "GitHub Issue number must be numeric");
  }
  return issueNumber;
}

function mapIssue(payload: GithubIssuePayload, binding: IssueProjectBinding, includeBody: boolean): IssueDetail {
  const id = resolveIdentifier(payload.id, "id");
  const number = resolveNumber(payload.number, "number");
  const title = resolveString(payload.title, "title");
  const state = payload.state === "closed" ? "closed" : payload.state === "open" ? "open" : undefined;
  const url = resolveString(payload.html_url, "html_url");
  const createdAt = resolveString(payload.created_at, "created_at");
  const updatedAt = resolveString(payload.updated_at, "updated_at");
  if (!state) {
    throw new GithubIssueProviderError("invalid-response", "GitHub Issue state is invalid");
  }
  const summary: IssueSummary = {
    ref: {
      provider: "github",
      remoteKey: binding.remoteKey,
      issueId: id,
      issueNumber: String(number),
    },
    title,
    state,
    author: mapActor(payload.user),
    assignees: mapActors(payload.assignees),
    labels: mapLabels(payload.labels),
    url,
    createdAt,
    updatedAt,
  };
  if (!includeBody || typeof payload.body !== "string" || payload.body.length === 0) {
    return summary;
  }
  return { ...summary, body: payload.body };
}

function mapActor(value: unknown) {
  if (!isRecord(value) || typeof value.id !== "number" || typeof value.login !== "string") {
    return undefined;
  }
  return { id: String(value.id), displayName: value.login };
}

function mapActors(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => mapActor(item))
    .filter((item): item is NonNullable<ReturnType<typeof mapActor>> => item !== undefined);
}

function mapLabels(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "number" || typeof item.name !== "string") {
      return [];
    }
    return [{
      id: String(item.id),
      name: item.name,
      ...(typeof item.color === "string" && item.color.length > 0 ? { color: item.color } : {}),
    }];
  });
}

function resolveString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new GithubIssueProviderError("invalid-response", `GitHub Issue field ${field} is invalid`);
  }
  return value;
}

function resolveIdentifier(value: unknown, field: string): string {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return String(value);
  }
  return resolveString(value, field);
}

function resolveNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new GithubIssueProviderError("invalid-response", `GitHub Issue field ${field} is invalid`);
  }
  return value;
}

function resolveHttpError(response: Response): GithubIssueProviderError {
  const retryAfterSeconds = resolveRetryAfterSeconds(response.headers.get("retry-after"));
  if (response.status === 401) {
    return new GithubIssueProviderError("unauthorized", "GitHub token was rejected", { status: response.status });
  }
  if (response.status === 403) {
    return new GithubIssueProviderError(
      retryAfterSeconds === undefined ? "forbidden" : "rate-limited",
      retryAfterSeconds === undefined ? "GitHub denied access to the repository" : "GitHub rate limit exceeded",
      { status: response.status, retryAfterSeconds },
    );
  }
  if (response.status === 404) {
    return new GithubIssueProviderError("not-found", "GitHub repository or Issue was not found", { status: response.status });
  }
  if (response.status === 429) {
    return new GithubIssueProviderError("rate-limited", "GitHub rate limit exceeded", {
      status: response.status,
      retryAfterSeconds,
    });
  }
  if (response.status >= 500) {
    return new GithubIssueProviderError("unavailable", "GitHub is temporarily unavailable", { status: response.status });
  }
  return new GithubIssueProviderError("network", `GitHub returned HTTP ${response.status}`, { status: response.status });
}

function resolveRetryAfterSeconds(value: string | null) {
  if (!value) {
    return undefined;
  }
  const seconds = Number.parseInt(value, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

function resolveNextCursor(link: string | null) {
  if (!link) {
    return undefined;
  }
  const match = /<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="next"/u.exec(link);
  return match?.[1];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
