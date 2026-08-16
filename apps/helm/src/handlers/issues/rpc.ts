import type { ProjectSummary } from "@tiller/shared";
import type { HelmHandlerContext } from "../context";
import { createGithubIssueClient } from "../../integrations/issues/github/client";
import { toIssueError } from "../../integrations/issues/github/errors";

type IssueListParams = {
  projectId: string;
  state?: "open" | "closed" | "all";
  limit?: number;
  cursor?: string;
};

type IssueGetParams = {
  projectId: string;
  issueNumber: string;
};

export async function handleIssueRpcRequest(
  method: string,
  params: unknown,
  context: HelmHandlerContext,
): Promise<unknown | undefined> {
  switch (method) {
    case "issue/list":
      return listIssues(params as IssueListParams, context);
    case "issue/get":
      return getIssue(params as IssueGetParams, context);
    default:
      return undefined;
  }
}

export async function listIssues(params: IssueListParams, context: HelmHandlerContext) {
  const project = await resolveProject(params.projectId, context);
  if (!project) {
    return {
      ok: false,
      projectId: params.projectId,
      issues: [],
      message: "Project was not found",
      error: { kind: "project-not-found" as const, message: "Project was not found" },
    };
  }
  if (!project.issueBinding) {
    return {
      ok: false,
      projectId: project.id,
      issues: [],
      message: "Project has no GitHub Issue repository binding",
      error: {
        kind: "not-configured" as const,
        message: "Project has no GitHub Issue repository binding",
      },
    };
  }
  try {
    const result = await (context.issueClient ?? createGithubIssueClient()).list({
      binding: project.issueBinding,
      state: params.state,
      limit: params.limit,
      cursor: params.cursor,
    });
    return {
      ok: true,
      projectId: project.id,
      issues: result.issues,
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      message: `Loaded ${result.issues.length} GitHub Issue(s)`,
    };
  } catch (error) {
    const issueError = toIssueError(error);
    return {
      ok: false,
      projectId: project.id,
      issues: [],
      message: issueError.message,
      error: issueError,
    };
  }
}

export async function getIssue(params: IssueGetParams, context: HelmHandlerContext) {
  const project = await resolveProject(params.projectId, context);
  if (!project) {
    return {
      ok: false,
      projectId: params.projectId,
      message: "Project was not found",
      error: { kind: "project-not-found" as const, message: "Project was not found" },
    };
  }
  if (!project.issueBinding) {
    return {
      ok: false,
      projectId: project.id,
      message: "Project has no GitHub Issue repository binding",
      error: {
        kind: "not-configured" as const,
        message: "Project has no GitHub Issue repository binding",
      },
    };
  }
  try {
    const issue = await (context.issueClient ?? createGithubIssueClient()).get({
      binding: project.issueBinding,
      issueNumber: params.issueNumber,
    });
    return {
      ok: true,
      projectId: project.id,
      issue,
      message: "Loaded GitHub Issue detail",
    };
  } catch (error) {
    const issueError = toIssueError(error);
    return {
      ok: false,
      projectId: project.id,
      message: issueError.message,
      error: issueError,
    };
  }
}

async function resolveProject(projectId: string, context: HelmHandlerContext): Promise<ProjectSummary | undefined> {
  const projects = await context.loadAvailableProjectsWithSemanticSummaries();
  context.setProjects(projects);
  return context.resolveProjectById(projectId, projects);
}
