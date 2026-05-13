import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { saveProjectYaml } from "@tiller/agent-registry";
import type { ProjectSummary, WorktreeSummary } from "@tiller/shared";

const execFileAsync = promisify(execFile);
const GIT_COMMAND_TIMEOUT_MS = 8000;

function normalizeGitBranchName(input: string) {
  return input.trim().replace(/\s+/g, "-");
}

function safeWorktreeSlug(input: string) {
  return normalizeGitBranchName(input).replace(/[^a-zA-Z0-9._/-]+/g, "-").replace(/[\\/]+/g, "-");
}

export function resolveProjectRoot(project: ProjectSummary, worktrees: WorktreeSummary[]) {
  return project.path ?? worktrees[0]?.path;
}

export async function resolveGitRoot(cwd: string) {
  const result = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
  return result.stdout.trim().replace(/\\/g, "/");
}

export async function listGitBranches(gitRoot: string) {
  const [branchesResult, currentResult] = await Promise.all([
    runGit(gitRoot, ["branch", "--format=%(refname:short)"]),
    runGit(gitRoot, ["branch", "--show-current"]),
  ]);
  return {
    branches: branchesResult.stdout.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean),
    currentBranch: currentResult.stdout.trim() || undefined,
  };
}

export async function listGitWorktreeWorktrees(project: ProjectSummary, gitRoot: string) {
  const result = await runGit(gitRoot, ["worktree", "list", "--porcelain"]);
  const worktrees: WorktreeSummary[] = [];
  let currentPath: string | undefined;
  let currentBranch: string | undefined;
  for (const line of result.stdout.split(/\r?\n/u)) {
    if (line.startsWith("worktree ")) {
      if (currentPath) {
        worktrees.push(toWorktree(project, currentPath, currentBranch));
      }
      currentPath = line.slice("worktree ".length).trim().replace(/\\/g, "/");
      currentBranch = undefined;
    } else if (line.startsWith("branch ")) {
      currentBranch = line.slice("branch ".length).replace(/^refs\/heads\//u, "").trim();
    }
  }
  if (currentPath) {
    worktrees.push(toWorktree(project, currentPath, currentBranch));
  }
  return worktrees;
}

function toWorktree(project: ProjectSummary, path: string, branch?: string): WorktreeSummary {
  return {
    name: branch ?? basename(path),
    path,
    branch,
    kind: normalizePath(path) === normalizePath(project.path) ? "root" : "git-worktree",
  };
}

export function projectWorktreeItems(project: ProjectSummary, worktrees: WorktreeSummary[]) {
  return mergeWorktrees(project.worktrees ?? [], worktrees);
}

export function persistProjectGitInfo(
  project: ProjectSummary,
  gitInfo: { branches: string[]; currentBranch?: string },
  projectRoot: string,
  configPath: string,
) {
  const rootWorktree: WorktreeSummary = {
    name: gitInfo.currentBranch ?? basename(projectRoot),
    path: projectRoot.replace(/\\/g, "/"),
    branch: gitInfo.currentBranch,
    kind: "root",
  };
  saveProjectYaml(
    {
      ...stripRuntimeProjectSummary(project),
      gitBranches: gitInfo.branches,
      gitCurrentBranch: gitInfo.currentBranch,
      worktrees: mergeWorktrees(project.worktrees ?? [], [rootWorktree]),
    },
    configPath,
  );
}

export async function persistProjectGitInfoIfAvailable(
  project: ProjectSummary,
  worktrees: WorktreeSummary[],
  configPath: string,
) {
  const projectRoot = resolveProjectRoot(project, worktrees);
  if (!projectRoot) {
    return;
  }
  const gitRoot = await resolveGitRoot(projectRoot);
  const gitInfo = await listGitBranches(gitRoot);
  persistProjectGitInfo(project, gitInfo, projectRoot, configPath);
}

export async function refreshProjectGitBranches(
  projects: ProjectSummary[],
  worktrees: WorktreeSummary[],
  configPath: string,
) {
  let updated = 0;
  const failures: Array<{ projectId: string; message: string }> = [];
  for (const project of projects) {
    try {
      const root = resolveProjectRoot(project, worktrees);
      if (!root) {
        continue;
      }
      const gitRoot = await resolveGitRoot(root);
      const gitInfo = await listGitBranches(gitRoot);
      if (
        gitInfo.currentBranch !== project.gitCurrentBranch ||
        gitInfo.branches.join("\0") !== (project.gitBranches ?? []).join("\0")
      ) {
        persistProjectGitInfo(project, gitInfo, root, configPath);
        updated += 1;
      }
    } catch (error) {
      failures.push({ projectId: project.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { updated, failures };
}

export async function createProjectWorktree(
  project: ProjectSummary,
  worktrees: WorktreeSummary[],
  branchName: string,
  configPath: string,
) {
  const projectRoot = resolveProjectRoot(project, worktrees);
  if (!projectRoot) {
    throw new Error("Project has no path.");
  }
  const gitRoot = await resolveGitRoot(projectRoot);
  const normalized = normalizeGitBranchName(branchName);
  const worktreePath = join(gitRoot, ".worktrees", safeWorktreeSlug(normalized));
  await mkdir(join(gitRoot, ".worktrees"), { recursive: true });
  await runGit(gitRoot, ["worktree", "add", worktreePath, normalized]);
  const worktree: WorktreeSummary = {
    name: normalized,
    path: worktreePath.replace(/\\/g, "/"),
    branch: normalized,
    kind: "git-worktree",
  };
  saveProjectYaml({ ...project, worktrees: mergeWorktrees(project.worktrees ?? [], [worktree]) }, configPath);
  return worktree;
}

function mergeWorktrees(left: WorktreeSummary[], right: WorktreeSummary[]) {
  const byPath = new Map<string, WorktreeSummary>();
  for (const item of [...left, ...right]) {
    byPath.set(normalizePath(item.path) ?? item.path, item);
  }
  return Array.from(byPath.values());
}

function normalizePath(path: string | undefined) {
  return path?.replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

function stripRuntimeProjectSummary(project: ProjectSummary): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    helmId: project.helmId,
    path: project.path,
    summary: project.summary,
    gitBranches: project.gitBranches,
    gitCurrentBranch: project.gitCurrentBranch,
    worktrees: project.worktrees,
  };
}

async function runGit(cwd: string, args: string[]) {
  return execFileAsync("git", ["-C", cwd, ...args], {
    timeout: GIT_COMMAND_TIMEOUT_MS,
    windowsHide: true,
  });
}
