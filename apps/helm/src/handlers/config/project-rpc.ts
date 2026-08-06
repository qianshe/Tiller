import {
  deleteProjectFromConfig,
  saveProjectToConfig,
} from "@tiller/agent-registry";
import { realpathSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
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
  getProjectGitStatus,
  type GitStatusSnapshot,
  commitProjectGitChanges,
  discardProjectGitChanges,
  getProjectGitGraph,
  emptyGitSnapshot,
  pushProjectGitChanges,
  pullProjectGitChanges,
  resolveGitQueueRoot,
  type GitCommit,
  type GitCommitFile,
  getProjectGitCommitDetail,
  getProjectGitFileDiffs,
} from "./project-git";

// Per-git-root serial queue: all Git operations for the same repository
// (including linked worktrees sharing the same git-common-dir) are serialized
// via this queue, preventing concurrent ref writes to the same repo.
type GitStatusRpcResult = {
  ok: boolean;
  projectId: string;
  cwd: string;
  message: string;
} & GitStatusSnapshot;

type GitCommitRpcResult = GitStatusRpcResult & {
  commitHash?: string;
};

type GitGraphRpcResult = {
  ok: boolean;
  projectId: string;
  cwd: string;
  head?: string;
  commits: GitCommit[];
  signature?: string;
  unchanged?: boolean;
  message: string;
};

type GitCommitDetailRpcResult = {
  ok: boolean;
  projectId: string;
  cwd: string;
  commitHash: string;
  files: GitCommitFile[];
  message: string;
};

type GitFileDiffRpcResult = {
  ok: boolean;
  projectId: string;
  cwd: string;
  files: Array<{
    path: string;
    originalPath?: string;
    additions: number;
    deletions: number;
    patch?: string;
    patchTruncated?: boolean;
  }>;
  message: string;
};

type ResolvedProjectGitContext = {
  project: ProjectSummary;
  cwd: string;
};

const gitOperationQueues = new Map<string, Promise<unknown>>();

async function withGitQueue<T>(
  cwd: string,
  operation: () => Promise<T>,
): Promise<T> {
  // Resolve the shared git-common-dir before enqueueing so linked worktrees
  // with different cwd paths still map to the same queue slot.
  const queueRoot = await resolveGitQueueRoot(cwd);
  const previous = gitOperationQueues.get(queueRoot) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(() => operation());
  gitOperationQueues.set(queueRoot, current);
  try {
    return await current;
  } finally {
    if (gitOperationQueues.get(queueRoot) === current) {
      gitOperationQueues.delete(queueRoot);
    }
  }
}

// Request deduplication maps to prevent concurrent duplicate Git operations.
// Key includes refreshRemote to distinguish normal status from remote-aware refresh.
const pendingGitStatusRequests = new Map<string, Promise<GitStatusRpcResult>>();
const pendingGitCommitRequests = new Map<string, Promise<GitCommitRpcResult>>();
const pendingGitDiscardRequests = new Map<string, Promise<GitStatusRpcResult>>();
const pendingGitPushRequests = new Map<string, Promise<GitStatusRpcResult>>();
const pendingGitPullRequests = new Map<string, Promise<GitStatusRpcResult>>();
const pendingGitGraphRequests = new Map<string, Promise<GitGraphRpcResult>>();
const pendingGitCommitDetailRequests = new Map<string, Promise<GitCommitDetailRpcResult>>();
const pendingGitFileDiffRequests = new Map<string, Promise<GitFileDiffRpcResult>>();

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
      const projectRoot = resolveProjectRoot(nextProject, nextWorktrees) ?? worktree.path;
      persistProjectGitInfo(nextProject, gitInfo, projectRoot, context.configPath);
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

async function resolveProjectGitContext(
  params: { projectId: string; cwd?: string },
  context: HelmHandlerContext,
): Promise<ResolvedProjectGitContext | { projectId: string; cwd: string; message: string }> {
  const projects = await context.loadAvailableProjectsWithSemanticSummaries();
  const worktrees = context.loadAvailableWorktrees();
  const project = context.resolveProjectById(params.projectId, projects);

  if (!project) {
    return { projectId: params.projectId, cwd: params.cwd ?? "", message: "Project not found" };
  }

  const cwd = params.cwd ?? resolveProjectRoot(project, worktrees);
  if (!cwd) {
    return { projectId: project.id, cwd: "", message: "Project has no path or worktree path" };
  }

  if (!isProjectWorktree(project, worktrees, cwd)) {
    return { projectId: project.id, cwd, message: "Working directory is not part of this project" };
  }

  return { project, cwd };
}

function gitSnapshotFailure(
  projectId: string,
  cwd: string,
  message: string,
  snapshot: GitStatusSnapshot = emptyGitSnapshot(),
): GitStatusRpcResult {
  return { ok: false, projectId, cwd, ...snapshot, message };
}

async function bestEffortGitSnapshot(cwd: string): Promise<GitStatusSnapshot> {
  try {
    return await getProjectGitStatus(cwd, { remoteConfirmed: false });
  } catch {
    return emptyGitSnapshot();
  }
}

export async function getGitStatus(
  params: { projectId: string; cwd?: string; refreshRemote?: boolean },
  context: HelmHandlerContext,
): Promise<GitStatusRpcResult> {
  const resolved = await resolveProjectGitContext(params, context);
  if (!("project" in resolved)) {
    return gitSnapshotFailure(resolved.projectId, resolved.cwd, resolved.message);
  }

  const dedupeKey = `${resolved.project.id}:${resolved.cwd}:${params.refreshRemote ? "1" : "0"}`;
  const pending = pendingGitStatusRequests.get(dedupeKey);
  if (pending) {
    return await pending;
  }

  const promise = withGitQueue(resolved.cwd, () =>
    executeGetGitStatus(params, resolved),
  );
  pendingGitStatusRequests.set(dedupeKey, promise);

  try {
    return await promise;
  } finally {
    pendingGitStatusRequests.delete(dedupeKey);
  }
}

async function executeGetGitStatus(
  params: { refreshRemote?: boolean },
  resolved: ResolvedProjectGitContext,
): Promise<GitStatusRpcResult> {

  try {
    const snapshot = await getProjectGitStatus(resolved.cwd, { refreshRemote: params.refreshRemote });
    return {
      ok: true,
      projectId: resolved.project.id,
      cwd: resolved.cwd,
      ...snapshot,
      message: snapshot.clean ? "Working tree clean" : `${snapshot.files.length} file(s) changed`,
    };
  } catch (error) {
    const snapshot = await bestEffortGitSnapshot(resolved.cwd);
    return gitSnapshotFailure(
      resolved.project.id,
      resolved.cwd,
      error instanceof Error ? error.message : "Failed to get Git status",
      snapshot,
    );
  }
}

export async function commitGitChanges(
  params: { projectId: string; cwd: string; message: string; paths: string[] },
  context: HelmHandlerContext,
) : Promise<GitCommitRpcResult> {
  const resolved = await resolveProjectGitContext(params, context);
  if (!("project" in resolved)) {
    return { ...gitSnapshotFailure(resolved.projectId, resolved.cwd, resolved.message), commitHash: undefined };
  }

  const dedupeKey = JSON.stringify([
    resolved.project.id,
    resolved.cwd,
    params.message,
    params.paths,
  ]);
  const pending = pendingGitCommitRequests.get(dedupeKey);
  if (pending) {
    return await pending;
  }

  const promise = withGitQueue(resolved.cwd, () =>
    executeCommitGitChanges(params, resolved),
  );
  pendingGitCommitRequests.set(dedupeKey, promise);

  try {
    return await promise;
  } finally {
    pendingGitCommitRequests.delete(dedupeKey);
  }
}

async function executeCommitGitChanges(
  params: { projectId: string; cwd: string; message: string; paths: string[] },
  resolved: ResolvedProjectGitContext,
): Promise<GitCommitRpcResult> {
  try {
    const { commitHash, status } = await commitProjectGitChanges(
      resolved.cwd,
      params.message,
      params.paths,
    );

    return {
      ok: true,
      projectId: resolved.project.id,
      cwd: resolved.cwd,
      commitHash,
      ...status,
      message: `Committed ${params.paths.length} file(s)`,
    };
  } catch (error) {
    const snapshot = await bestEffortGitSnapshot(resolved.cwd);
    return {
      ...gitSnapshotFailure(
        resolved.project.id,
        resolved.cwd,
        error instanceof Error ? error.message : "Failed to commit changes",
        snapshot,
      ),
      commitHash: undefined,
    };
  }
}

export async function discardGitChanges(
  params: { projectId: string; cwd: string; paths: string[] },
  context: HelmHandlerContext,
): Promise<GitStatusRpcResult> {
  const resolved = await resolveProjectGitContext(params, context);
  if (!("project" in resolved)) {
    return gitSnapshotFailure(resolved.projectId, resolved.cwd, resolved.message);
  }

  const dedupeKey = JSON.stringify([
    resolved.project.id,
    resolved.cwd,
    params.paths,
  ]);
  const pending = pendingGitDiscardRequests.get(dedupeKey);
  if (pending) {
    return await pending;
  }

  const promise = withGitQueue(resolved.cwd, async () => {
    try {
      const snapshot = await discardProjectGitChanges(resolved.cwd, params.paths);
      return {
        ok: true,
        projectId: resolved.project.id,
        cwd: resolved.cwd,
        ...snapshot,
        message: `Discarded ${params.paths.length} path(s)`,
      };
    } catch (error) {
      const snapshot = await bestEffortGitSnapshot(resolved.cwd);
      return gitSnapshotFailure(
        resolved.project.id,
        resolved.cwd,
        error instanceof Error ? error.message : "Failed to discard Git changes",
        snapshot,
      );
    }
  });
  pendingGitDiscardRequests.set(dedupeKey, promise);

  try {
    return await promise;
  } finally {
    pendingGitDiscardRequests.delete(dedupeKey);
  }
}

export async function pushGitChanges(
  params: { projectId: string; cwd: string },
  context: HelmHandlerContext,
) : Promise<GitStatusRpcResult> {
  const resolved = await resolveProjectGitContext(params, context);
  if (!("project" in resolved)) {
    return gitSnapshotFailure(resolved.projectId, resolved.cwd, resolved.message);
  }

  const dedupeKey = `${resolved.project.id}:${resolved.cwd}`;
  const pending = pendingGitPushRequests.get(dedupeKey);
  if (pending) {
    return await pending;
  }

  const promise = withGitQueue(resolved.cwd, () =>
    executePushGitChanges(resolved),
  );
  pendingGitPushRequests.set(dedupeKey, promise);

  try {
    return await promise;
  } finally {
    pendingGitPushRequests.delete(dedupeKey);
  }
}

async function executePushGitChanges(
  resolved: ResolvedProjectGitContext,
): Promise<GitStatusRpcResult> {
  try {
    const snapshot = await pushProjectGitChanges(resolved.cwd);
    return {
      ok: true,
      projectId: resolved.project.id,
      cwd: resolved.cwd,
      ...snapshot,
      message: "Pushed",
    };
  } catch (error) {
    const snapshot = await bestEffortGitSnapshot(resolved.cwd);
    return gitSnapshotFailure(
      resolved.project.id,
      resolved.cwd,
      error instanceof Error ? error.message : "Failed to push changes",
      snapshot,
    );
  }
}

export async function pullGitChanges(
  params: { projectId: string; cwd: string },
  context: HelmHandlerContext,
) : Promise<GitStatusRpcResult> {
  const resolved = await resolveProjectGitContext(params, context);
  if (!("project" in resolved)) {
    return gitSnapshotFailure(resolved.projectId, resolved.cwd, resolved.message);
  }

  const dedupeKey = `${resolved.project.id}:${resolved.cwd}`;
  const pending = pendingGitPullRequests.get(dedupeKey);
  if (pending) {
    return await pending;
  }

  const promise = withGitQueue(resolved.cwd, () =>
    executePullGitChanges(resolved),
  );
  pendingGitPullRequests.set(dedupeKey, promise);

  try {
    return await promise;
  } finally {
    pendingGitPullRequests.delete(dedupeKey);
  }
}

async function executePullGitChanges(
  resolved: ResolvedProjectGitContext,
): Promise<GitStatusRpcResult> {
  try {
    const snapshot = await pullProjectGitChanges(resolved.cwd);
    return {
      ok: true,
      projectId: resolved.project.id,
      cwd: resolved.cwd,
      ...snapshot,
      message: "Fast-forwarded",
    };
  } catch (error) {
    const snapshot = await bestEffortGitSnapshot(resolved.cwd);
    return gitSnapshotFailure(
      resolved.project.id,
      resolved.cwd,
      error instanceof Error ? error.message : "Failed to pull changes",
      snapshot,
    );
  }
}

function isProjectWorktree(
  project: ProjectSummary,
  worktrees: Array<{ name: string; path: string; branch?: string }>,
  cwd: string,
): boolean {
  const normalizedCwd = normalizeProjectPath(cwd);
  const allowedPaths = new Set(
    projectWorktreeItems(project, worktrees).map((worktree) =>
      normalizeProjectPath(worktree.path),
    ),
  );
  const projectPath = normalizeProjectPath(project.path);
  if (projectPath) {
    allowedPaths.add(projectPath);
  }
  return allowedPaths.has(normalizedCwd);
}

function normalizeProjectPath(path: string | undefined) {
  if (!path) {
    return "";
  }
  let canonicalPath: string;
  try {
    canonicalPath = realpathSync.native(path);
  } catch {
    canonicalPath = resolvePath(path);
  }
  const normalized = canonicalPath.replace(/\\/g, "/").replace(/\/+$/u, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}


export async function getGitGraph(
  params: { projectId: string; cwd?: string; knownSignature?: string },
  context: HelmHandlerContext,
) : Promise<GitGraphRpcResult> {
  const resolved = await resolveProjectGitContext(params, context);
  if (!("project" in resolved)) {
    return {
      ok: false,
      projectId: resolved.projectId,
      cwd: resolved.cwd,
      head: undefined,
      commits: [],
      message: resolved.message,
    };
  }

  // knownSignature participates in the key: an unchanged short-circuit for one
  // client must not be replayed to a client that still needs the full payload.
  const dedupeKey = `${resolved.project.id}:${resolved.cwd}:${params.knownSignature ?? ""}`;
  const pending = pendingGitGraphRequests.get(dedupeKey);
  if (pending) {
    return await pending;
  }

  const promise = withGitQueue(resolved.cwd, () =>
    executeGetGitGraph(resolved, params.knownSignature),
  );
  pendingGitGraphRequests.set(dedupeKey, promise);

  try {
    return await promise;
  } finally {
    pendingGitGraphRequests.delete(dedupeKey);
  }
}

async function executeGetGitGraph(
  resolved: ResolvedProjectGitContext,
  knownSignature?: string,
): Promise<GitGraphRpcResult> {
  try {
    const { head, commits, signature, unchanged } = await getProjectGitGraph(
      resolved.cwd,
      knownSignature,
    );
    return {
      ok: true,
      projectId: resolved.project.id,
      cwd: resolved.cwd,
      head,
      commits,
      signature,
      ...(unchanged ? { unchanged } : {}),
      message: unchanged ? "Graph unchanged" : `Fetched ${commits.length} commit(s)`,
    };
  } catch (error) {
    return {
      ok: false,
      projectId: resolved.project.id,
      cwd: resolved.cwd,
      head: undefined,
      commits: [],
      message: error instanceof Error ? error.message : "Failed to fetch Git graph",
    };
  }
}

export async function getGitFileDiffs(
  params: { projectId: string; cwd: string; paths: string[] },
  context: HelmHandlerContext,
): Promise<GitFileDiffRpcResult> {
  const resolved = await resolveProjectGitContext(params, context);
  if (!("project" in resolved)) {
    return {
      ok: false,
      projectId: resolved.projectId,
      cwd: resolved.cwd,
      files: [],
      message: resolved.message,
    };
  }
  if (!params.paths?.length) {
    return {
      ok: false,
      projectId: resolved.project.id,
      cwd: resolved.cwd,
      files: [],
      message: "At least one path is required",
    };
  }

  const dedupeKey = `${resolved.project.id}:${resolved.cwd}:${[...params.paths].sort().join("\0")}`;
  const pending = pendingGitFileDiffRequests.get(dedupeKey);
  if (pending) {
    return await pending;
  }

  const promise = withGitQueue(resolved.cwd, async (): Promise<GitFileDiffRpcResult> => {
    try {
      const diffs = await getProjectGitFileDiffs(resolved.cwd, params.paths);
      return {
        ok: true,
        projectId: resolved.project.id,
        cwd: resolved.cwd,
        files: diffs.map((diff) => ({
          path: diff.path,
          additions: diff.additions,
          deletions: diff.deletions,
          ...(diff.patch ? { patch: diff.patch } : {}),
          ...(diff.patchTruncated ? { patchTruncated: true } : {}),
        })),
        message: `Fetched ${diffs.length} file diff(s)`,
      };
    } catch (error) {
      return {
        ok: false,
        projectId: resolved.project.id,
        cwd: resolved.cwd,
        files: [],
        message: error instanceof Error ? error.message : "Failed to read file diffs",
      };
    }
  });
  pendingGitFileDiffRequests.set(dedupeKey, promise);
  try {
    return await promise;
  } finally {
    pendingGitFileDiffRequests.delete(dedupeKey);
  }
}

export async function getGitCommitDetail(
  params: { projectId: string; cwd: string; commitHash: string },
  context: HelmHandlerContext,
): Promise<GitCommitDetailRpcResult> {
  const resolved = await resolveProjectGitContext(params, context);
  if (!("project" in resolved)) {
    return {
      ok: false,
      projectId: resolved.projectId,
      cwd: resolved.cwd,
      commitHash: params.commitHash,
      files: [],
      message: resolved.message,
    };
  }

  const dedupeKey = `${resolved.project.id}:${resolved.cwd}:${params.commitHash}`;
  const pending = pendingGitCommitDetailRequests.get(dedupeKey);
  if (pending) {
    return await pending;
  }
  const promise = withGitQueue(resolved.cwd, async () => {
    try {
      const detail = await getProjectGitCommitDetail(resolved.cwd, params.commitHash);
      return {
        ok: true,
        projectId: resolved.project.id,
        cwd: resolved.cwd,
        ...detail,
        message: `Fetched ${detail.files.length} file(s)`,
      };
    } catch (error) {
      return {
        ok: false,
        projectId: resolved.project.id,
        cwd: resolved.cwd,
        commitHash: params.commitHash,
        files: [],
        message: error instanceof Error ? error.message : "Failed to fetch commit detail",
      };
    }
  });
  pendingGitCommitDetailRequests.set(dedupeKey, promise);
  try {
    return await promise;
  } finally {
    pendingGitCommitDetailRequests.delete(dedupeKey);
  }
}
