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
  return project.path ?? projectWorktreeItems(project, worktrees)[0]?.path;
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
  if (project.worktrees?.length) {
    return mergeWorktrees([], project.worktrees);
  }
  if (!project.path) {
    return [];
  }
  const matchedRoot = worktrees.filter(
    (worktree) => normalizePath(worktree.path) === normalizePath(project.path),
  );
  if (matchedRoot.length) {
    return mergeWorktrees([], matchedRoot);
  }
  return [{
    name: project.gitCurrentBranch ?? basename(project.path),
    path: project.path.replace(/\\/g, "/"),
    branch: project.gitCurrentBranch,
    kind: "root" as const,
  }];
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
      let nextProject = project;
      if (
        gitInfo.currentBranch !== project.gitCurrentBranch ||
        gitInfo.branches.join("\0") !== (project.gitBranches ?? []).join("\0")
      ) {
        persistProjectGitInfo(project, gitInfo, root, configPath);
        nextProject = {
          ...project,
          gitBranches: gitInfo.branches,
          gitCurrentBranch: gitInfo.currentBranch,
        };
        updated += 1;
      }
      const gitWorktreeWorktrees = await listGitWorktreeWorktrees(nextProject, gitRoot);
      const projectWithDiscoveredWorktrees = persistDiscoveredWorktrees(
        nextProject,
        gitWorktreeWorktrees,
        configPath,
      );
      if (projectWithDiscoveredWorktrees !== nextProject) {
        updated += 1;
      }
    } catch (error) {
      failures.push({ projectId: project.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { updated, failures };
}

export function persistDiscoveredWorktrees(
  project: ProjectSummary,
  worktrees: WorktreeSummary[],
  configPath: string,
) {
  const preserved = (project.worktrees ?? []).filter((worktree) => worktree.kind !== "git-worktree");
  const nextWorktrees = mergeWorktrees(preserved, worktrees);
  const currentSnapshot = (project.worktrees ?? []).map(worktreeFingerprint).join("\0");
  const nextSnapshot = nextWorktrees.map(worktreeFingerprint).join("\0");
  if (currentSnapshot === nextSnapshot) {
    return project;
  }
  const nextProject = { ...project, worktrees: nextWorktrees };
  saveProjectYaml(stripRuntimeProjectSummary(nextProject), configPath);
  return nextProject;
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

function worktreeFingerprint(worktree: WorktreeSummary) {
  return [
    normalizePath(worktree.path) ?? "",
    worktree.name ?? "",
    worktree.branch ?? "",
    worktree.kind ?? "",
  ].join("\u001f");
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

export async function getProjectGitStatus(cwd: string) {
  const gitRoot = await resolveGitRoot(cwd);

  // Get current branch
  const branchResult = await runGit(gitRoot, ["branch", "--show-current"]);
  const branch = branchResult.stdout.trim();

  // Get status with null-terminated output for reliable parsing
  const statusResult = await runGit(gitRoot, ["status", "--porcelain=v1", "-z"]);
  const statusOutput = statusResult.stdout;

  // Parse status output (null-terminated format)
  const files: Array<{
    path: string;
    indexStatus: string;
    worktreeStatus: string;
    originalPath?: string;
  }> = [];

  if (statusOutput.length > 0) {
    const entries = statusOutput.split("\0").filter(Boolean);
    let i = 0;
    while (i < entries.length) {
      const entry = entries[i];
      if (!entry || entry.length < 3) {
        i++;
        continue;
      }

      const indexStatus = entry[0] ?? " ";
      const worktreeStatus = entry[1] ?? " ";
      const pathPart = entry.slice(3);

      // Handle renames (R) and copies (C): next entry is the new path
      if ((indexStatus === "R" || indexStatus === "C") && i + 1 < entries.length) {
        const originalPath = pathPart;
        const newPath = entries[i + 1];
        files.push({
          path: newPath!,
          indexStatus,
          worktreeStatus,
          originalPath,
        });
        i += 2; // Skip both entries
      } else {
        files.push({ path: pathPart, indexStatus, worktreeStatus });
        i++;
      }
    }
  }

  const clean = files.length === 0;

  return { branch, clean, files };
}

export async function commitProjectGitChanges(
  cwd: string,
  message: string,
  paths: string[],
) {
  // Validate message
  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    throw new Error("Commit message cannot be empty");
  }

  // Validate paths
  if (paths.length === 0) {
    throw new Error("At least one path is required");
  }

  const gitRoot = await resolveGitRoot(cwd);

  // Validate that all paths are within git root
  const normalizedGitRoot = normalizePath(gitRoot);
  for (const path of paths) {
    const normalizedPath = normalizePath(join(gitRoot, path));
    if (!normalizedPath?.startsWith(normalizedGitRoot ?? "")) {
      throw new Error(`Path ${path} is outside git repository`);
    }
  }

  // Stage only the specified paths
  await runGit(gitRoot, ["add", "--", ...paths]);

  // Commit
  const commitResult = await runGit(gitRoot, ["commit", "-m", trimmedMessage]);

  // Extract commit hash from output
  const hashMatch = /\[.+\s+([a-f0-9]{7,40})\]/u.exec(commitResult.stdout);
  const commitHash = hashMatch?.[1];

  // Get updated status
  const status = await getProjectGitStatus(gitRoot);

  return { commitHash, status };
}


export interface GitRef {
  name: string;
  kind: "branch" | "tag" | "detached";
  isCurrent: boolean;
}

export interface GitCommit {
  hash: string;
  parents: string[];
  refs: GitRef[];
  subject: string;
  authorName: string;
  authoredAt: string;
  body?: string;
  changedFiles?: number;
  insertions?: number;
  deletions?: number;
}

export async function getProjectGitGraph(cwd: string, commitCount: number = 60) {
  const gitRoot = await resolveGitRoot(cwd);

  // Get current HEAD hash
  let head: string | undefined;
  try {
    const headResult = await runGit(gitRoot, ["rev-parse", "HEAD"]);
    head = headResult.stdout.trim();
  } catch {
    // Detached or no HEAD, will be handled
  }

  // Get symbolic-ref for current branch to determine if detached
  let currentBranch: string | undefined;
  try {
    const branchResult = await runGit(gitRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const branch = branchResult.stdout.trim();
    if (branch !== "HEAD") {
      currentBranch = branch;
    }
  } catch {
    // Ignore
  }

  // Fetch git log with decoration and body in one pass.
  const logFormat = "%H%x00%P%x00%D%x00%s%x00%an%x00%aI%x00%b%x00%x1e";
  const logResult = await runGit(gitRoot, [
    "log",
    `--max-count=${commitCount}`,
    `--format=${logFormat}`,
    "--decorate=full",
    "--topo-order",
  ]);

  const commits: GitCommit[] = [];
  const records = logResult.stdout
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean);

  for (const record of records) {
    const fields = record.split("\0");
    if (fields.length < 7) {
      continue;
    }

    const hash = fields[0]?.trim();
    if (!hash) {
      continue;
    }
    const parentsLine = fields[1]?.trim() ?? "";
    const decoLine = fields[2]?.trim() ?? "";
    const subject = fields[3]?.trim() ?? "";
    const authorName = fields[4]?.trim() ?? "";
    const authoredAt = fields[5]?.trim() ?? "";
    const body = fields
      .slice(6)
      .join("\0")
      .replace(/\uFFFD/gu, "")
      .trim();

    const parents = parentsLine ? parentsLine.split(/\s+/) : [];
    const refs = parseRefs(decoLine, currentBranch);

    commits.push({
      hash,
      parents,
      refs,
      subject,
      authorName,
      authoredAt,
      ...(body ? { body } : {}),
    });
  }

  return { head, commits };
}

function parseRefs(
  decoLine: string,
  currentBranch: string | undefined,
): GitRef[] {
  const refs: GitRef[] = [];

  if (!decoLine) {
    return refs;
  }

  // Remove outer parentheses
  let content = decoLine;
  if (content.startsWith("(") && content.endsWith(")")) {
    content = content.slice(1, -1);
  }

  // Split by comma to get individual refs
  const refParts = content.split(",").map((p) => p.trim());

  for (const part of refParts) {
    if (part === "HEAD") {
      refs.push({
        name: "HEAD",
        kind: "detached",
        isCurrent: true,
      });
    } else if (part.startsWith("tag: ")) {
      const tagName = normalizeGitRefName(part.slice("tag: ".length));
      refs.push({
        name: tagName,
        kind: "tag",
        isCurrent: false,
      });
    } else if (part.startsWith("HEAD -> ")) {
      const branchName = normalizeGitRefName(part.slice("HEAD -> ".length));
      refs.push({
        name: branchName,
        kind: "branch",
        isCurrent: true,
      });
    } else {
      const branchName = normalizeGitRefName(part);
      refs.push({
        name: branchName,
        kind: "branch",
        isCurrent: branchName === currentBranch,
      });
    }
  }

  return refs;
}

function normalizeGitRefName(refName: string) {
  return refName
    .replace(/^refs\/heads\//u, "")
    .replace(/^refs\/remotes\//u, "")
    .replace(/^refs\/tags\//u, "")
    .trim();
}
