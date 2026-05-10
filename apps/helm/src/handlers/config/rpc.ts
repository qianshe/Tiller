import {
  deleteProjectFromConfig,
  deleteProviderFromConfig,
  listAvailableProviders,
  saveHelmToConfig,
  saveProjectToConfig,
  saveProviderToConfig,
  saveWorkspaceToConfig,
} from "@tiller/agent-registry";
import type {
  AcpAgentProvider,
  HelmSummary,
  ProjectSummary,
  WorkspaceSummary,
} from "@tiller/shared";
import { isProjectRootBranchWorkspace } from "../../sessions/facade";
import type { HelmHandlerContext } from "../context";
import { listProjectFiles, resolveProjectFileRoot } from "./project-files";
import {
  createProjectWorktree,
  listGitBranches,
  listGitWorktreeWorkspaces,
  persistProjectGitInfo,
  persistProjectGitInfoIfAvailable,
  projectWorkspaceItems,
  resolveGitRoot,
  resolveProjectRoot,
} from "./project-git";

export async function handleConfigRpcRequest(
  method: string,
  params: unknown,
  context: HelmHandlerContext,
): Promise<unknown | undefined> {
  switch (method) {
    case "helm/list":
      return listHelms(context);
    case "helm/save":
      return saveHelm(params as { helm: HelmSummary }, context);
    case "project/list":
      return listProjects(context);
    case "project/list_files":
      return listFiles(params as { projectId: string; workspaceId?: string }, context);
    case "project/save":
      return saveProject(params as { project: ProjectSummary }, context);
    case "project/delete":
      return deleteProject(params as { projectId: string }, context);
    case "workspace/list":
      return listWorkspaces(context);
    case "workspace/save":
      return saveWorkspace(params as { workspace: WorkspaceSummary }, context);
    case "workspace/git/list_branches":
      return listBranches(params as { projectId: string }, context);
    case "workspace/git/create_branch":
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
        params as { providerId: string; workspaceId?: string; projectId?: string },
        context,
      );
    case "agent/reconnect":
      return reconnectAgent(
        params as { providerId: string; workspaceId?: string; projectId?: string },
        context,
      );
    case "agent/get_model_options":
      return getModelOptions(
        params as { providerId: string; workspaceId: string; projectId?: string },
        context,
      );
    default:
      return undefined;
  }
}

function listHelms(context: HelmHandlerContext) {
  const helms = context.loadAvailableHelms();
  context.setHelms(helms);
  return { helms };
}

async function saveHelm(params: { helm: HelmSummary }, context: HelmHandlerContext) {
  const result = saveHelmToConfig(params.helm, context.configPath);
  context.setHelms(context.loadAvailableHelms());
  context.setProjects(await context.loadAvailableProjectsWithSemanticSummaries());
  return {
    ok: true,
    helmId: params.helm.id,
    message: `Saved Helm model config to ${result.configPath}`,
  };
}

async function listProjects(context: HelmHandlerContext) {
  const projects = await context.loadAvailableProjectsWithSemanticSummaries();
  context.setProjects(projects);
  return { projects };
}

async function listFiles(
  params: { projectId: string; workspaceId?: string },
  context: HelmHandlerContext,
) {
  const projects = await context.loadAvailableProjectsWithSemanticSummaries();
  const workspaces = context.loadAvailableWorkspaces();
  context.setProjects(projects);
  context.setWorkspaces(workspaces);
  const project = context.resolveProjectById(params.projectId, projects);
  if (!project) {
    return {
      ok: false,
      projectId: params.projectId,
      workspaceId: params.workspaceId,
      files: [],
      message: "Project not found",
    };
  }
  const projectRoot = resolveProjectFileRoot(project, workspaces, params.workspaceId);
  if (!projectRoot) {
    return {
      ok: false,
      projectId: project.id,
      workspaceId: params.workspaceId,
      files: [],
      message: "Project has no path or workspace path",
    };
  }
  try {
    const result = await listProjectFiles(projectRoot);
    return {
      ok: true,
      projectId: project.id,
      workspaceId: params.workspaceId,
      files: result.files,
      message: result.message,
    };
  } catch (error) {
    return {
      ok: false,
      projectId: project.id,
      workspaceId: params.workspaceId,
      files: [],
      message: error instanceof Error ? error.message : "Failed to list project files",
    };
  }
}

async function saveProject(params: { project: ProjectSummary }, context: HelmHandlerContext) {
  const result = saveProjectToConfig(params.project, context.configPath);
  const savedWorkspaces = context.loadAvailableWorkspaces();
  try {
    await persistProjectGitInfoIfAvailable(params.project, savedWorkspaces, context.configPath);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to refresh project Git branches";
    context.logError(
      `[tiller] project.save.git.refresh.failed project=${params.project.id} message=${message}`,
    );
  }
  context.setWorkspaces(context.loadAvailableWorkspaces());
  context.setProjects(await context.loadAvailableProjectsWithSemanticSummaries());
  return {
    ok: true,
    projectId: params.project.id,
    message: `Saved project to ${result.configPath}`,
  };
}

async function deleteProject(params: { projectId: string }, context: HelmHandlerContext) {
  const result = deleteProjectFromConfig(params.projectId, context.configPath);
  context.setWorkspaces(context.loadAvailableWorkspaces());
  context.setProjects(await context.loadAvailableProjectsWithSemanticSummaries());
  return {
    ok: result.deleted,
    projectId: params.projectId,
    message: result.deleted
      ? `Deleted project from ${result.configPath}`
      : `Project not found in ${result.configPath}`,
  };
}

function listWorkspaces(context: HelmHandlerContext) {
  const workspaces = context.loadAvailableWorkspaces();
  context.setWorkspaces(workspaces);
  return { workspaces };
}

async function saveWorkspace(params: { workspace: WorkspaceSummary }, context: HelmHandlerContext) {
  const result = saveWorkspaceToConfig(params.workspace, context.configPath);
  const workspaces = context.loadAvailableWorkspaces();
  const projects = await context.loadAvailableProjectsWithSemanticSummaries();
  context.setWorkspaces(workspaces);
  context.setProjects(projects);
  return {
    ok: true,
    workspaceId: params.workspace.id,
    message: `Saved workspace to ${result.configPath}`,
  };
}

async function listBranches(params: { projectId: string }, context: HelmHandlerContext) {
  const projects = await context.loadAvailableProjectsWithSemanticSummaries();
  const workspaces = context.loadAvailableWorkspaces();
  context.setProjects(projects);
  context.setWorkspaces(workspaces);
  const project = context.resolveProjectById(params.projectId, projects);
  if (!project) {
    return {
      ok: false,
      projectId: params.projectId,
      branches: [],
      workspaces: [],
      message: "Project not found",
    };
  }
  const projectRoot = resolveProjectRoot(project, workspaces);
  try {
    const gitRoot = projectRoot ? await resolveGitRoot(projectRoot) : undefined;
    const gitInfo = gitRoot
      ? await listGitBranches(gitRoot)
      : { branches: [], currentBranch: undefined };
    if (gitInfo.branches.length && projectRoot) {
      persistProjectGitInfo(project, gitInfo, projectRoot, context.configPath);
      context.setProjects(await context.loadAvailableProjectsWithSemanticSummaries());
      context.setWorkspaces(context.loadAvailableWorkspaces());
    }
    const latestWorkspaces = context.loadAvailableWorkspaces();
    const latestProject = context.resolveProjectById(project.id, context.getProjects()) ?? project;
    const configuredWorkspaces = projectWorkspaceItems(latestProject, latestWorkspaces);
    const gitWorktreeWorkspaces = gitRoot
      ? await listGitWorktreeWorkspaces(latestProject, gitRoot)
      : [];
    const nextProject = persistDiscoveredWorktrees(
      latestProject,
      gitWorktreeWorkspaces,
      context.configPath,
    );
    if (nextProject !== latestProject) {
      context.setProjects(await context.loadAvailableProjectsWithSemanticSummaries());
      context.setWorkspaces(context.loadAvailableWorkspaces());
    }
    return {
      ok: true,
      projectId: project.id,
      branches: gitInfo.branches,
      currentBranch: gitInfo.currentBranch,
      workspaces: mergeWorkspaceItems(configuredWorkspaces, gitWorktreeWorkspaces),
      selectedWorkspaceId: gitInfo.currentBranch ?? project.defaultWorkspaceId,
      message: gitRoot ? "Git worktrees loaded" : "Project has no workspace path",
    };
  } catch (error) {
    return {
      ok: false,
      projectId: project.id,
      branches: [],
      workspaces: projectWorkspaceItems(project, workspaces),
      message: error instanceof Error ? error.message : "Failed to list Git worktrees",
    };
  }
}

function mergeWorkspaceItems(
  configuredWorkspaces: WorkspaceSummary[],
  gitWorktreeWorkspaces: WorkspaceSummary[],
) {
  const byId = new Map(configuredWorkspaces.map((workspace) => [workspace.id, workspace]));
  gitWorktreeWorkspaces.forEach((workspace) => byId.set(workspace.id, workspace));
  return Array.from(byId.values());
}

function persistDiscoveredWorktrees(
  project: ProjectSummary,
  worktrees: WorkspaceSummary[],
  configPath: string,
) {
  if (!worktrees.length) {
    return project;
  }
  worktrees.forEach((workspace) => saveWorkspaceToConfig(workspace, configPath));
  const workspaceIds = Array.from(
    new Set([...(project.workspaceIds ?? []), ...worktrees.map((workspace) => workspace.id)]),
  );
  if (
    workspaceIds.length === (project.workspaceIds ?? []).length &&
    workspaceIds.every((id, index) => id === project.workspaceIds?.[index])
  ) {
    return project;
  }
  const nextProject = { ...project, workspaceIds };
  saveProjectToConfig(nextProject, configPath);
  return nextProject;
}

async function createBranch(
  params: { projectId: string; branchName: string },
  context: HelmHandlerContext,
) {
  const projects = await context.loadAvailableProjectsWithSemanticSummaries();
  const workspaces = context.loadAvailableWorkspaces();
  const project = context.resolveProjectById(params.projectId, projects);
  if (!project) {
    return {
      ok: false,
      projectId: params.projectId,
      branches: [],
      workspaces: [],
      message: "Project not found",
    };
  }
  try {
    const workspace = await createProjectWorktree(
      project,
      workspaces,
      params.branchName,
      context.configPath,
    );
    const nextProjects = await context.loadAvailableProjectsWithSemanticSummaries();
    const nextWorkspaces = context.loadAvailableWorkspaces();
    context.setProjects(nextProjects);
    context.setWorkspaces(nextWorkspaces);
    const gitRoot = await resolveGitRoot(workspace.path);
    const gitInfo = await listGitBranches(gitRoot);
    const nextProject = context.resolveProjectById(project.id, nextProjects) ?? project;
    if (gitInfo.branches.length) {
      persistProjectGitInfo(nextProject, gitInfo, workspace.path, context.configPath);
    }
    return {
      ok: true,
      projectId: project.id,
      branches: gitInfo.branches,
      currentBranch: params.branchName,
      workspaces: projectWorkspaceItems(nextProject, nextWorkspaces),
      selectedWorkspaceId: workspace.id,
      message: `Created worktree ${params.branchName}`,
    };
  } catch (error) {
    return {
      ok: false,
      projectId: project.id,
      branches: [],
      workspaces: projectWorkspaceItems(project, workspaces),
      message: error instanceof Error ? error.message : "Failed to create Git worktree",
    };
  }
}

function listAgents(context: HelmHandlerContext) {
  const agents = context.loadAvailableAgents();
  context.setAgents(agents);
  return { agents };
}

async function saveAgent(params: { provider: AcpAgentProvider }, context: HelmHandlerContext) {
  const provider = {
    id: params.provider.id,
    name: params.provider.name,
    kind: params.provider.kind,
    command: params.provider.command,
    args: params.provider.args,
    env: params.provider.env,
    cwd: params.provider.cwd,
    initializeTimeoutMs: params.provider.initializeTimeoutMs,
    defaultAgent: params.provider.defaultAgent,
    transport: "stdio" as const,
    protocol: "acp" as const,
    installHint: params.provider.installHint,
  };
  const result = saveProviderToConfig(provider, context.configPath);
  context.setAgents(listAvailableProviders(context.configPath));
  context.setProjects(await context.loadAvailableProjectsWithSemanticSummaries());
  return {
    ok: true,
    providerId: provider.id,
    message: `Saved provider to ${result.configPath}`,
  };
}

async function deleteAgent(params: { providerId: string }, context: HelmHandlerContext) {
  const result = deleteProviderFromConfig(params.providerId, context.configPath);
  context.setAgents(listAvailableProviders(context.configPath));
  context.setProjects(await context.loadAvailableProjectsWithSemanticSummaries());
  return {
    ok: result.deleted,
    providerId: params.providerId,
    message: result.deleted
      ? `Deleted provider from ${result.configPath}`
      : `Provider not found in ${result.configPath}`,
  };
}

async function testAgent(params: { providerId: string }, context: HelmHandlerContext) {
  const agent = context.resolveProviderById(params.providerId, context.getAgents());
  if (!agent) {
    return {
      ok: false,
      providerId: params.providerId,
      message: "Provider not found",
    };
  }
  const workspace = context.getWorkspaces()[0];
  const result = await context.testAcpConnection(agent, workspace?.path);
  return {
    ok: result.ok,
    providerId: params.providerId,
    message: result.message,
  };
}


function listAgentConnections(context: HelmHandlerContext) {
  return { connections: context.listAcpConnectionInventory() };
}


function resolveAgentWorkspace(
  params: { providerId: string; workspaceId?: string; projectId?: string },
  context: HelmHandlerContext,
) {
  const agent = context.resolveProviderById(params.providerId, context.getAgents());
  const workspaces = context.getWorkspaces();
  const baseWorkspace = params.workspaceId
    ? workspaces.find((item) => item.id === params.workspaceId)
    : workspaces[0];
  const project = params.projectId
    ? context.resolveProjectById(params.projectId, context.getProjects())
    : undefined;
  const workspace =
    project && baseWorkspace && project.path && isProjectRootBranchWorkspace(project, baseWorkspace)
      ? { ...baseWorkspace, path: project.path }
      : baseWorkspace;
  return { agent, workspace };
}

async function connectAgent(
  params: { providerId: string; workspaceId?: string; projectId?: string },
  context: HelmHandlerContext,
) {
  const { agent, workspace } = resolveAgentWorkspace(params, context);
  if (!agent || !workspace) {
    return {
      ok: false,
      providerId: params.providerId,
      workspaceId: params.workspaceId,
      connections: context.listAcpConnectionInventory(),
      message: !agent ? "Provider not found" : "Workspace not found",
    };
  }

  context.logInfo(
    `[tiller] 阶段=ACP连接请求 provider=${agent.id} workspace=${workspace.id} cwd=${workspace.path}`,
  );
  try {
    const connection = await context.connectAcpConnection({
      sessionId: `connect-${agent.id}-${Date.now()}`,
      agent,
      workspace,
      onEvent: () => undefined,
      onConnectionLifecycleEvent: (event) => {
        context.logInfo(
          `[tiller] 阶段=ACP连接打开 provider=${event.providerId} key=${event.key} workspace=${event.workspaceId}`,
        );
      },
    });
    const inventory = connection.inventory();
    return {
      ok: true,
      providerId: agent.id,
      workspaceId: workspace.id,
      runtimeConnectionId: inventory.runtimeConnectionId,
      connection: inventory,
      connections: context.listAcpConnectionInventory(),
      message: "ACP provider connected.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to connect ACP provider";
    context.logError(
      `[tiller] 阶段=ACP连接失败 provider=${agent.id} workspace=${workspace.id} message=${message}`,
    );
    return {
      ok: false,
      providerId: agent.id,
      workspaceId: workspace.id,
      connections: context.listAcpConnectionInventory(),
      message,
    };
  }
}

async function reconnectAgent(
  params: { providerId: string; workspaceId?: string; projectId?: string },
  context: HelmHandlerContext,
) {
  const { agent, workspace } = resolveAgentWorkspace(params, context);

  if (!agent || !workspace) {
    return {
      ok: false,
      providerId: params.providerId,
      workspaceId: params.workspaceId,
      message: !agent ? "Provider not found" : "Workspace not found",
    };
  }

  context.logInfo(
    `[tiller] 阶段=ACP重连请求 provider=${agent.id} workspace=${workspace.id} cwd=${workspace.path}`,
  );
  try {
    const connection = await context.reconnectAcpConnection({
      sessionId: `reconnect-${agent.id}-${Date.now()}`,
      agent,
      workspace,
      onEvent: () => undefined,
      onConnectionLifecycleEvent: (event) => {
        context.logInfo(
          `[tiller] 阶段=ACP连接${event.type === "connection-reconnect" ? "重连" : "打开"} provider=${event.providerId} key=${event.key} workspace=${event.workspaceId}`,
        );
      },
    });
    const inventory = connection.inventory();
    context.logInfo(
      `[tiller] 阶段=ACP重连完成 provider=${agent.id} workspace=${workspace.id} connection=${inventory.runtimeConnectionId}`,
    );
    return {
      ok: true,
      providerId: agent.id,
      workspaceId: workspace.id,
      runtimeConnectionId: inventory.runtimeConnectionId,
      connection: inventory,
      connections: context.listAcpConnectionInventory(),
      message: "ACP provider reconnected.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reconnect ACP provider";
    context.logError(
      `[tiller] 阶段=ACP重连失败 provider=${agent.id} workspace=${workspace.id} message=${message}`,
    );
    return {
      ok: false,
      providerId: agent.id,
      workspaceId: workspace.id,
      connections: context.listAcpConnectionInventory(),
      message,
    };
  }
}

async function getModelOptions(
  params: { providerId: string; workspaceId: string; projectId?: string },
  context: HelmHandlerContext,
) {
  const agent = context.resolveProviderById(params.providerId, context.getAgents());
  const workspaces = context.getWorkspaces();
  const baseWorkspace = workspaces.find((item) => item.id === params.workspaceId);
  const project = params.projectId
    ? context.resolveProjectById(params.projectId, context.getProjects())
    : undefined;
  const workspace =
    project && baseWorkspace && project.path && isProjectRootBranchWorkspace(project, baseWorkspace)
      ? { ...baseWorkspace, path: project.path }
      : baseWorkspace;
  if (!agent || !workspace) {
    return {
      ok: false,
      providerId: params.providerId,
      workspaceId: params.workspaceId,
      message: !agent ? "Provider not found" : "Workspace not found",
      modelOptions: [],
      configOptions: [],
      state: {},
    };
  }
  const result = await context.probeAgentModelOptions(agent, workspace);
  return {
    providerId: agent.id,
    workspaceId: workspace.id,
    ...result,
  };
}
