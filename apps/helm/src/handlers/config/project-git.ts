import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { readTillerConfig, saveProjectToConfig, saveWorkspaceToConfig } from "@tiller/agent-registry";
import type { ProjectSummary, WorkspaceSummary } from "@tiller/shared";

const execFileAsync = promisify(execFile);
const GIT_COMMAND_TIMEOUT_MS = 8000;
function normalizeGitBranchName(input: string) {
  return input.trim().replace(/\s+/g, "-");
}

function validateGitBranchName(branchName: string) {
  if (
    !branchName ||
    branchName.includes("..") ||
    branchName.startsWith("/") ||
    branchName.endsWith("/") ||
    !/^[A-Za-z0-9._/-]+$/.test(branchName)
  ) {
    throw new Error(
      "Branch name can only contain letters, numbers, dot, slash, underscore and dash.",
    );
  }
}

function safeWorktreeSlug(branchName: string) {
  return branchName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "worktree";
}

async function runGit(cwd: string, args: string[]) {
  return execFileAsync("git", ["-C", cwd, ...args], {
    timeout: GIT_COMMAND_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
}

export async function resolveGitRoot(path: string) {
  const result = await runGit(path, ["rev-parse", "--show-toplevel"]);
  return result.stdout.trim() || path;
}

export async function listGitBranches(root: string) {
  const [branchesResult, currentResult] = await Promise.all([
    runGit(root, ["branch", "--format=%(refname:short)"]),
    runGit(root, ["branch", "--show-current"]).catch(() => ({ stdout: "" })),
  ]);
  return {
    branches: branchesResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
    currentBranch: currentResult.stdout.trim() || undefined,
  };
}

export function resolveProjectRoot(project: ProjectSummary, workspaces: WorkspaceSummary[]) {
  if (project.path) {
    return project.path;
  }
  const workspace =
    workspaces.find((item) => item.id === project.defaultWorkspaceId) ??
    workspaces.find((item) => project.workspaceIds?.includes(item.id));
  return workspace?.path;
}

export function projectWorkspaceItems(project: ProjectSummary, workspaces: WorkspaceSummary[]) {
  if (!project.workspaceIds?.length) {
    return workspaces;
  }
  return workspaces.filter((workspace) => project.workspaceIds?.includes(workspace.id));
}

function isNonGitRepositoryError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /not a git repository|not a git repo|outside repository/i.test(message);
}

export function resolveProjectWorkspaceId(
  project: Pick<ProjectSummary, "id" | "gitCurrentBranch">,
  currentBranch?: string,
) {
  return currentBranch?.trim() || project.gitCurrentBranch?.trim() || `${project.id}-workspace`;
}

function isProjectRootWorkspaceId(
  project: ProjectSummary,
  gitInfo: { branches: string[]; currentBranch?: string },
  workspaceId: string,
) {
  return (
    workspaceId === `${project.id}-workspace` ||
    workspaceId === project.gitCurrentBranch ||
    gitInfo.branches.includes(workspaceId)
  );
}

function stripRuntimeProjectSummary(project: ProjectSummary) {
  const { summary: _runtimeSummary, ...persistableProject } = project;
  return persistableProject;
}

export function persistProjectGitInfo(
  project: ProjectSummary,
  gitInfo: { branches: string[]; currentBranch?: string },
  projectRoot: string,
  configPath: string,
) {
  const workspaceId = resolveProjectWorkspaceId(project, gitInfo.currentBranch);
  const previousWorkspaceIds = project.workspaceIds ?? [];
  const workspaceIds = Array.from(
    new Set([
      workspaceId,
      ...previousWorkspaceIds.filter(
        (id) => id === workspaceId || !isProjectRootWorkspaceId(project, gitInfo, id),
      ),
    ]),
  );
  saveProjectToConfig(
    {
      ...stripRuntimeProjectSummary(project),
      workspaceIds,
      defaultWorkspaceId: workspaceId,
      gitBranches: gitInfo.branches,
      gitCurrentBranch: gitInfo.currentBranch,
    },
    configPath,
  );
  if (gitInfo.currentBranch) {
    saveProjectRootWorkspaceToConfig(
      {
        id: workspaceId,
        name: gitInfo.currentBranch,
        path: projectRoot.replace(/\\/g, "/"),
      },
      project,
      gitInfo,
      configPath,
    );
  }
}

function saveProjectRootWorkspaceToConfig(
  workspace: WorkspaceSummary,
  project: ProjectSummary,
  gitInfo: { branches: string[]; currentBranch?: string },
  configPath: string,
) {
  const current = readTillerConfig(configPath);
  const retainedWorkspaces = (current.workspaces ?? []).filter(
    (item) => item.id !== workspace.id && !isProjectRootWorkspaceId(project, gitInfo, item.id),
  );
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        ...current,
        workspaces: [...retainedWorkspaces, workspace],
      },
      null,
      2,
    ),
    "utf8",
  );
}

export function shouldPersistProjectGitInfo(
  project: ProjectSummary,
  gitInfo: { branches: string[]; currentBranch?: string },
) {
  const previous = project.gitBranches ?? [];
  const branchChanged =
    previous.length !== gitInfo.branches.length ||
    previous.some((branch, index) => branch !== gitInfo.branches[index]);
  const currentChanged = project.gitCurrentBranch !== gitInfo.currentBranch;
  const workspaceId = resolveProjectWorkspaceId(project, gitInfo.currentBranch);
  const workspaceChanged =
    project.defaultWorkspaceId !== workspaceId ||
    !(project.workspaceIds ?? []).includes(workspaceId) ||
    (project.workspaceIds ?? []).some(
      (id) => id !== workspaceId && isProjectRootWorkspaceId(project, gitInfo, id),
    );
  return branchChanged || currentChanged || workspaceChanged;
}

export async function persistProjectGitInfoIfAvailable(
  project: ProjectSummary,
  workspaces: WorkspaceSummary[],
  configPath: string,
) {
  const projectRoot = resolveProjectRoot(project, workspaces);
  if (!projectRoot) {
    return false;
  }

  try {
    const gitRoot = await resolveGitRoot(projectRoot);
    const gitInfo = await listGitBranches(gitRoot);
    if (!gitInfo.branches.length) {
      return false;
    }

    if (shouldPersistProjectGitInfo(project, gitInfo)) {
      persistProjectGitInfo(project, gitInfo, projectRoot, configPath);
      return true;
    }
    return false;
  } catch (error) {
    if (isNonGitRepositoryError(error)) {
      return false;
    }
    throw error;
  }
}

export async function createProjectWorktree(
  project: ProjectSummary,
  workspaces: WorkspaceSummary[],
  branchNameInput: string,
  configPath: string,
) {
  const branchName = normalizeGitBranchName(branchNameInput);
  validateGitBranchName(branchName);
  const projectRoot = resolveProjectRoot(project, workspaces);
  if (!projectRoot) {
    throw new Error("Project has no path or workspace path to create a Git worktree from.");
  }
  const gitRoot = await resolveGitRoot(projectRoot);
  const { branches } = await listGitBranches(gitRoot);
  const branchExists = branches.includes(branchName);
  if (!branchExists) {
    throw new Error(
      `Branch ${branchName} does not exist. Create the branch in Git first, then reload project branches.`,
    );
  }
  const worktreePath = join(gitRoot, ".tiller", "worktrees", safeWorktreeSlug(branchName));
  await mkdir(join(gitRoot, ".tiller", "worktrees"), { recursive: true });
  await runGit(gitRoot, ["worktree", "add", worktreePath, branchName]);

  const workspaceId = `${project.id}-worktree-${safeWorktreeSlug(branchName)}`;
  const workspace: WorkspaceSummary = {
    id: workspaceId,
    name: branchName,
    path: worktreePath.replace(/\\/g, "/"),
  };
  saveWorkspaceToConfig(workspace, configPath);
  saveProjectToConfig(
    {
      ...project,
      workspaceIds: Array.from(new Set([...(project.workspaceIds ?? []), workspaceId])),
      defaultWorkspaceId: project.defaultWorkspaceId ?? workspaceId,
    },
    configPath,
  );
  return workspace;
}

export async function refreshProjectGitBranches(
  projects: ProjectSummary[],
  workspaces: WorkspaceSummary[],
  configPath: string,
) {
  let updated = 0;
  let skipped = 0;
  const failures: Array<{ projectId: string; message: string }> = [];

  for (const project of projects) {
    const projectRoot = resolveProjectRoot(project, workspaces);
    if (!projectRoot) {
      skipped += 1;
      continue;
    }

    try {
      const gitRoot = await resolveGitRoot(projectRoot);
      const gitInfo = await listGitBranches(gitRoot);
      if (!gitInfo.branches.length) {
        skipped += 1;
        continue;
      }

      if (shouldPersistProjectGitInfo(project, gitInfo)) {
        persistProjectGitInfo(project, gitInfo, projectRoot, configPath);
        updated += 1;
      }
    } catch (error) {
      if (isNonGitRepositoryError(error)) {
        skipped += 1;
        continue;
      }
      failures.push({
        projectId: project.id,
        message: error instanceof Error ? error.message : "Failed to refresh Git branches",
      });
    }
  }

  return { updated, skipped, failures };
}
