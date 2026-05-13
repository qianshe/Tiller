import {
  deleteProjectFromConfig,
  deleteProviderFromConfig,
  listAvailableProviders,
  saveHelmToConfig,
  saveProjectToConfig,
  saveProviderToConfig,
} from "@tiller/agent-registry";
import type {
  AcpAgentProvider,
  HelmSummary,
  ProjectSummary,
  WorktreeSummary,
} from "@tiller/shared";
import { isProjectRootBranchWorktree } from "../../sessions/facade";
import type { HelmHandlerContext } from "../context";
import { listProjectFiles, resolveProjectFileRoot } from "./project-files";
import {
  createProjectWorktree,
  listGitBranches,
  listGitWorktreeWorktrees,
  persistProjectGitInfo,
  persistProjectGitInfoIfAvailable,
  projectWorktreeItems,
  refreshProjectGitBranches,
  resolveGitRoot,
  resolveProjectRoot,
} from "./project-git";

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
    case "project/list":
      return listProjects(context);
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

function shutdownDaemon(context: HelmHandlerContext) {
  context.requestShutdown?.("rpc");
  return {
    ok: true,
    message: "Helm shutdown requested.",
  };
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
  let projects = await context.loadAvailableProjectsWithSemanticSummaries();
  const worktrees = context.loadAvailableWorktrees();
  try {
    const refresh = await refreshProjectGitBranches(projects, worktrees, context.configPath);
    if (refresh.updated > 0) {
      projects = await context.loadAvailableProjectsWithSemanticSummaries();
      context.setWorktrees(context.loadAvailableWorktrees());
    }
    if (refresh.failures.length > 0) {
      context.logError(
        `[tiller] project.git.refresh failures=${refresh.failures.length}`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to refresh project Git branches";
    context.logError(`[tiller] project.git.refresh failed message=${message}`);
  }
  context.setProjects(projects);
  return { projects };
}

async function listFiles(
  params: { projectId: string; cwd?: string },
  context: HelmHandlerContext,
) {
  const projects = await context.loadAvailableProjectsWithSemanticSummaries();
  const worktrees = context.loadAvailableWorktrees();
  context.setProjects(projects);
  context.setWorktrees(worktrees);
  const project = context.resolveProjectById(params.projectId, projects);
  if (!project) {
    return {
      ok: false,
      projectId: params.projectId,
      cwd: params.cwd,
      files: [],
      message: "Project not found",
    };
  }
  const projectRoot = resolveProjectFileRoot(project, worktrees, params.cwd);
  if (!projectRoot) {
    return {
      ok: false,
      projectId: project.id,
      cwd: params.cwd,
      files: [],
      message: "Project has no path or worktree path",
    };
  }
  try {
    const result = await listProjectFiles(projectRoot);
    return {
      ok: true,
      projectId: project.id,
      cwd: params.cwd,
      files: result.files,
      message: result.message,
    };
  } catch (error) {
    return {
      ok: false,
      projectId: project.id,
      cwd: params.cwd,
      files: [],
      message: error instanceof Error ? error.message : "Failed to list project files",
    };
  }
}

async function saveProject(params: { project: ProjectSummary }, context: HelmHandlerContext) {
  const result = saveProjectToConfig(params.project, context.configPath);
  const savedWorktrees = context.loadAvailableWorktrees();
  try {
    await persistProjectGitInfoIfAvailable(params.project, savedWorktrees, context.configPath);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to refresh project Git branches";
    context.logError(
      `[tiller] project.save.git.refresh.failed project=${params.project.id} message=${message}`,
    );
  }
  context.setWorktrees(context.loadAvailableWorktrees());
  context.setProjects(await context.loadAvailableProjectsWithSemanticSummaries());
  return {
    ok: true,
    projectId: params.project.id,
    message: `Saved project to ${result.configPath}`,
  };
}

async function deleteProject(params: { projectId: string }, context: HelmHandlerContext) {
  const result = deleteProjectFromConfig(params.projectId, context.configPath);
  context.setWorktrees(context.loadAvailableWorktrees());
  context.setProjects(await context.loadAvailableProjectsWithSemanticSummaries());
  return {
    ok: result.deleted,
    projectId: params.projectId,
    message: result.deleted
      ? `Deleted project from ${result.configPath}`
      : `Project not found in ${result.configPath}`,
  };
}

async function listProjectWorktrees(
  params: { projectId: string },
  context: HelmHandlerContext,
) {
  const projects = await context.loadAvailableProjectsWithSemanticSummaries();
  const worktrees = context.loadAvailableWorktrees();
  context.setProjects(projects);
  context.setWorktrees(worktrees);
  const project = context.resolveProjectById(params.projectId, projects);
  if (!project) {
    return {
      ok: false,
      projectId: params.projectId,
      worktrees: [],
      message: "Project not found",
    };
  }
  return {
    ok: true,
    projectId: project.id,
    worktrees: projectWorktreeItems(project, worktrees),
    message: "Project worktrees loaded",
  };
}

async function listBranches(params: { projectId: string }, context: HelmHandlerContext) {
  const projects = await context.loadAvailableProjectsWithSemanticSummaries();
  const worktrees = context.loadAvailableWorktrees();
  context.setProjects(projects);
  context.setWorktrees(worktrees);
  const project = context.resolveProjectById(params.projectId, projects);
  if (!project) {
    return {
      ok: false,
      projectId: params.projectId,
      branches: [],
      worktrees: [],
      message: "Project not found",
    };
  }
  const projectRoot = resolveProjectRoot(project, worktrees);
  try {
    const gitRoot = projectRoot ? await resolveGitRoot(projectRoot) : undefined;
    const gitInfo = gitRoot
      ? await listGitBranches(gitRoot)
      : { branches: [], currentBranch: undefined };
    if (gitInfo.branches.length && projectRoot) {
      persistProjectGitInfo(project, gitInfo, projectRoot, context.configPath);
      context.setProjects(await context.loadAvailableProjectsWithSemanticSummaries());
      context.setWorktrees(context.loadAvailableWorktrees());
    }
    const latestProject = context.resolveProjectById(project.id, context.getProjects()) ?? project;
    const gitWorktreeWorktrees = gitRoot
      ? await listGitWorktreeWorktrees(latestProject, gitRoot)
      : [];
    const nextProject = persistDiscoveredWorktrees(
      latestProject,
      gitWorktreeWorktrees,
      context.configPath,
    );
    if (nextProject !== latestProject) {
      context.setProjects(await context.loadAvailableProjectsWithSemanticSummaries());
      context.setWorktrees(context.loadAvailableWorktrees());
    }
    const refreshedWorktrees = context.loadAvailableWorktrees();
    const refreshedProject = context.resolveProjectById(project.id, context.getProjects()) ?? nextProject;
    const configuredWorktrees = projectWorktreeItems(refreshedProject, refreshedWorktrees);
    return {
      ok: true,
      projectId: project.id,
      branches: gitInfo.branches,
      currentBranch: gitInfo.currentBranch,
      worktrees: mergeWorktreeItems(configuredWorktrees, gitWorktreeWorktrees),
      selectedCwd: refreshedProject.path ?? configuredWorktrees[0]?.path,
      message: gitRoot ? "Git worktrees loaded" : "Project has no worktree path",
    };
  } catch (error) {
    return {
      ok: false,
      projectId: project.id,
      branches: [],
      worktrees: projectWorktreeItems(project, worktrees),
      message: error instanceof Error ? error.message : "Failed to list Git worktrees",
    };
  }
}

function mergeWorktreeItems(
  configuredWorktrees: WorktreeSummary[],
  gitWorktreeWorktrees: WorktreeSummary[],
) {
  const byId = new Map(configuredWorktrees.map((worktree) => [worktree.path, worktree]));
  gitWorktreeWorktrees.forEach((worktree) => byId.set(worktree.path, worktree));
  return Array.from(byId.values());
}

function persistDiscoveredWorktrees(
  project: ProjectSummary,
  worktrees: WorktreeSummary[],
  configPath: string,
) {
  const preserved = (project.worktrees ?? []).filter((worktree) => worktree.kind !== "git-worktree");
  const nextWorktrees = mergeWorktreeItems(preserved, worktrees);
  const currentKeys = (project.worktrees ?? []).map((worktree) => worktree.path).join("\0");
  const nextKeys = nextWorktrees.map((worktree) => worktree.path).join("\0");
  if (currentKeys !== nextKeys) {
    const nextProject = { ...project, worktrees: nextWorktrees };
    saveProjectToConfig(nextProject, configPath);
    return nextProject;
  }
  return project;
}

async function createBranch(
  params: { projectId: string; branchName: string },
  context: HelmHandlerContext,
) {
  const projects = await context.loadAvailableProjectsWithSemanticSummaries();
  const worktrees = context.loadAvailableWorktrees();
  const project = context.resolveProjectById(params.projectId, projects);
  if (!project) {
    return {
      ok: false,
      projectId: params.projectId,
      branches: [],
      worktrees: [],
      message: "Project not found",
    };
  }
  try {
    const worktree = await createProjectWorktree(
      project,
      worktrees,
      params.branchName,
      context.configPath,
    );
    const nextProjects = await context.loadAvailableProjectsWithSemanticSummaries();
    const nextWorktrees = context.loadAvailableWorktrees();
    context.setProjects(nextProjects);
    context.setWorktrees(nextWorktrees);
    const gitRoot = await resolveGitRoot(worktree.path);
    const gitInfo = await listGitBranches(gitRoot);
    const nextProject = context.resolveProjectById(project.id, nextProjects) ?? project;
    if (gitInfo.branches.length) {
      persistProjectGitInfo(nextProject, gitInfo, worktree.path, context.configPath);
    }
    return {
      ok: true,
      projectId: project.id,
      branches: gitInfo.branches,
      currentBranch: params.branchName,
      worktrees: projectWorktreeItems(nextProject, nextWorktrees),
      selectedCwd: worktree.path,
      message: `Created worktree ${params.branchName}`,
    };
  } catch (error) {
    return {
      ok: false,
      projectId: project.id,
      branches: [],
      worktrees: projectWorktreeItems(project, worktrees),
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
  const worktree = context.getWorktrees()[0];
  const result = await context.testAcpConnection(agent, worktree?.path);
  return {
    ok: result.ok,
    providerId: params.providerId,
    message: result.message,
  };
}


function listAgentConnections(context: HelmHandlerContext) {
  return { connections: context.listAcpConnectionInventory() };
}


function resolveAgentWorktree(
  params: { providerId: string; cwd?: string; projectId?: string },
  context: HelmHandlerContext,
) {
  const agent = context.resolveProviderById(params.providerId, context.getAgents());
  const worktrees = context.getWorktrees();
  const requestedCwd = params.cwd?.trim();
  const baseWorktree = requestedCwd
    ? (worktrees.find((item) => normalizeWorktreePath(item.path) === normalizeWorktreePath(requestedCwd)) ?? {
        name: requestedCwd.split(/[\\/]/u).filter(Boolean).at(-1) ?? "cwd",
        path: requestedCwd,
      })
    : worktrees[0];
  const project = params.projectId
    ? context.resolveProjectById(params.projectId, context.getProjects())
    : undefined;
  const worktree =
    requestedCwd
      ? baseWorktree
      : project && baseWorktree && project.path && isProjectRootBranchWorktree(project, baseWorktree)
        ? { ...baseWorktree, path: project.path }
        : baseWorktree;
  return { agent, worktree };
}

function normalizeWorktreePath(path: string) {
  return path.replace(/\\/gu, "/").replace(/\/+$/u, "").toLowerCase();
}

async function connectAgent(
  params: { providerId: string; cwd?: string; projectId?: string },
  context: HelmHandlerContext,
) {
  const { agent, worktree } = resolveAgentWorktree(params, context);
  if (!agent || !worktree) {
    return {
      ok: false,
      providerId: params.providerId,
      cwd: params.cwd,
      connections: context.listAcpConnectionInventory(),
      message: !agent ? "Provider not found" : "Worktree not found",
    };
  }

  context.logInfo(
    `[tiller] 阶段=ACP连接请求 provider=${agent.id} cwd=${worktree.path}`,
  );
  try {
    const connection = await context.connectAcpConnection({
      sessionId: `connect-${agent.id}-${Date.now()}`,
      agent,
      worktree,
      onEvent: () => undefined,
      onConnectionLifecycleEvent: (event) => {
        context.logInfo(
          `[tiller] 阶段=ACP连接打开 provider=${event.providerId} key=${event.key} cwd=${event.cwd}`,
        );
      },
    });
    const inventory = connection.inventory();
    return {
      ok: true,
      providerId: agent.id,
      cwd: worktree.path,
      runtimeConnectionId: inventory.runtimeConnectionId,
      connection: inventory,
      connections: context.listAcpConnectionInventory(),
      message: "ACP provider connected.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to connect ACP provider";
    context.logError(
      `[tiller] 阶段=ACP连接失败 provider=${agent.id} cwd=${worktree.path} message=${message}`,
    );
    return {
      ok: false,
      providerId: agent.id,
      cwd: worktree.path,
      connections: context.listAcpConnectionInventory(),
      message,
    };
  }
}

async function reconnectAgent(
  params: { providerId: string; cwd?: string; projectId?: string },
  context: HelmHandlerContext,
) {
  const { agent, worktree } = resolveAgentWorktree(params, context);

  if (!agent || !worktree) {
    return {
      ok: false,
      providerId: params.providerId,
      cwd: params.cwd,
      message: !agent ? "Provider not found" : "Worktree not found",
    };
  }

  context.logInfo(
    `[tiller] 阶段=ACP重连请求 provider=${agent.id} cwd=${worktree.path}`,
  );
  try {
    const connection = await context.reconnectAcpConnection({
      sessionId: `reconnect-${agent.id}-${Date.now()}`,
      agent,
      worktree,
      onEvent: () => undefined,
      onConnectionLifecycleEvent: (event) => {
        context.logInfo(
          `[tiller] 阶段=ACP连接${event.type === "connection-reconnect" ? "重连" : "打开"} provider=${event.providerId} key=${event.key} cwd=${event.cwd}`,
        );
      },
    });
    const inventory = connection.inventory();
    context.logInfo(
      `[tiller] 阶段=ACP重连完成 provider=${agent.id} cwd=${worktree.path} connection=${inventory.runtimeConnectionId}`,
    );
    return {
      ok: true,
      providerId: agent.id,
      cwd: worktree.path,
      runtimeConnectionId: inventory.runtimeConnectionId,
      connection: inventory,
      connections: context.listAcpConnectionInventory(),
      message: "ACP provider reconnected.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reconnect ACP provider";
    context.logError(
      `[tiller] 阶段=ACP重连失败 provider=${agent.id} cwd=${worktree.path} message=${message}`,
    );
    return {
      ok: false,
      providerId: agent.id,
      cwd: worktree.path,
      connections: context.listAcpConnectionInventory(),
      message,
    };
  }
}

