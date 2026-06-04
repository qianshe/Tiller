import type { AcpAgentProvider, HelmSummary, ProjectSummary } from "@tiller/shared";
import type { HelmHandlerContext } from "../context";
import {
  connectAgent,
  deleteAgent,
  listAgentConnections,
  listAgents,
  reconnectAgent,
  saveAgent,
  testAgent,
} from "./agent-rpc";
import { listHelms, saveHelm, shutdownDaemon } from "./helm-rpc";
import { getLoggingSettings, saveLoggingSettings } from "./logging-rpc";
import {
  createBranch,
  deleteProject,
  listDirectories,
  listBranches,
  listFiles,
  listProjects,
  listProjectWorktrees,
  saveProject,
} from "./project-rpc";

export async function handleConfigRpcRequest(
  method: string,
  params: unknown,
  context: HelmHandlerContext,
): Promise<unknown | undefined> {
  switch (method) {
    case "daemon/shutdown":
      return shutdownDaemon(context);
    case "helm/list":
      return listHelms(context);
    case "helm/save":
      return saveHelm(params as { helm: HelmSummary }, context);
    case "logging/get":
      return getLoggingSettings(context);
    case "logging/save":
      return saveLoggingSettings(params as { logging?: Record<string, string> }, context);
    case "project/list":
      return listProjects(context);
    case "project/list_directories":
      return listDirectories(params as { path?: string });
    case "project/list_files":
      return listFiles(params as { projectId: string; cwd?: string }, context);
    case "project/save":
      return saveProject(params as { project: ProjectSummary }, context);
    case "project/delete":
      return deleteProject(params as { projectId: string }, context);
    case "project/list_worktrees":
      return listProjectWorktrees(params as { projectId: string }, context);
    case "project/git/list_branches":
      return listBranches(params as { projectId: string }, context);
    case "project/git/create_worktree":
      return createBranch(params as { projectId: string; branchName: string }, context);
    case "agent/list":
      return listAgents(context);
    case "agent/save":
      return saveAgent(params as { provider: AcpAgentProvider }, context);
    case "agent/delete":
      return deleteAgent(params as { providerId: string }, context);
    case "agent/test":
      return testAgent(params as { providerId: string }, context);
    case "agent/connections":
      return listAgentConnections(context);
    case "agent/connect":
      return connectAgent(
        params as { providerId: string; cwd?: string; projectId?: string },
        context,
      );
    case "agent/reconnect":
      return reconnectAgent(
        params as { providerId: string; cwd?: string; projectId?: string },
        context,
      );
    default:
      return undefined;
  }
}
