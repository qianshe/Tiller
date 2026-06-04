import {
  deleteProjectFromConfig,
  saveProjectToConfig,
} from "@tiller/agent-registry";
import type { ProjectSummary, WorktreeSummary } from "@tiller/shared";
import type { HelmHandlerContext } from "../context";
import { listProjectDirectories, listProjectFiles, resolveProjectFileRoot } from "./project-files";
import {
  createProjectWorktree,
  listGitBranches,
  listGitWorktreeWorktrees,
  persistDiscoveredWorktrees,
  persistProjectGitInfo,
  persistProjectGitInfoIfAvailable,
  projectWorktreeItems,
  refreshProjectGitBranches,
  resolveGitRoot,
  resolveProjectRoot,
} from "./project-git";

export async function listProjects(context: HelmHandlerContext) {
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

export async function listFiles(
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

export async function listDirectories(params: { path?: string }) {
  try {
    const result = await listProjectDirectories(params.path);
    return {
      ok: true,
      path: result.path,
      directories: result.directories,
      message: result.message,
    };
  } catch (error) {
    return {
      ok: false,
      path: params.path,
      directories: [],
      message: error instanceof Error ? error.message : "Failed to list directories",
    };
  }
}

export async function saveProject(params: { project: ProjectSummary }, context: HelmHandlerContext) {
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

export async function deleteProject(params: { projectId: string }, context: HelmHandlerContext) {
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

export async function listProjectWorktrees(
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
  try {
    const projectRoot = resolveProjectRoot(project, worktrees);
    const gitRoot = projectRoot ? await resolveGitRoot(projectRoot) : undefined;
    const gitWorktreeWorktrees = gitRoot
      ? await listGitWorktreeWorktrees(project, gitRoot)
      : [];
    const nextProject = persistDiscoveredWorktrees(
      project,
      gitWorktreeWorktrees,
      context.configPath,
    );
    if (nextProject !== project) {
      context.setProjects(await context.loadAvailableProjectsWithSemanticSummaries());
      context.setWorktrees(context.loadAvailableWorktrees());
    }
    const refreshedWorktrees = context.loadAvailableWorktrees();
    const refreshedProject = context.resolveProjectById(params.projectId, context.getProjects()) ?? nextProject;
    const configuredWorktrees = projectWorktreeItems(refreshedProject, refreshedWorktrees);
    return {
      ok: true,
      projectId: project.id,
      worktrees: mergeWorktreeItems(configuredWorktrees, gitWorktreeWorktrees),
      message: gitRoot ? "Git worktrees loaded" : "Project worktrees loaded",
    };
  } catch {
    const configuredWorktrees = projectWorktreeItems(project, worktrees);
    return {
      ok: true,
      projectId: project.id,
      worktrees: configuredWorktrees,
      message: "Project worktrees loaded",
    };
  }
}

export async function listBranches(params: { projectId: string }, context: HelmHandlerContext) {
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

export async function createBranch(
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

function mergeWorktreeItems(
  configuredWorktrees: WorktreeSummary[],
  gitWorktreeWorktrees: WorktreeSummary[],
) {
  const byId = new Map(configuredWorktrees.map((worktree) => [worktree.path, worktree]));
  gitWorktreeWorktrees.forEach((worktree) => byId.set(worktree.path, worktree));
  return Array.from(byId.values());
}
