import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve as resolvePath, sep } from "node:path";
import { promisify } from "node:util";
import { saveProjectYaml } from "@tiller/agent-registry";
import type { ProjectSummary, WorktreeSummary } from "@tiller/shared";
import {
  normalizeDiffPath,
  readWorktreeGitDiffStats,
  readWorktreeGitFileDiffs,
} from "../../sessions/facade";

const execFileAsync = promisify(execFile);
const GIT_COMMAND_TIMEOUT_MS = 8000;
const GIT_GRAPH_INITIAL_COMMIT_LIMIT = 60;

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

/**
 * Resolve the shared repository root used for serializing Git operations
 * across a primary repo and its linked worktrees. Uses the normalized
 * `git rev-parse --git-common-dir` so linked worktrees map to the same
 * queue root as the primary repo, preventing concurrent ref writes.
 *
 * Fully defensive: if Git cannot resolve the path (e.g. cwd does not
 * exist on disk, or it is not a Git worktree), returns the cwd itself
 * as the queue key. This preserves the contract that project/cwd
 * validation in the RPC layer runs before any Git command touches the
 * filesystem — an invalid cwd simply serializes under its own key and
 * is rejected by the caller's worktree guard.
 */
export async function resolveGitQueueRoot(cwd: string): Promise<string> {
  try {
    const result = await runGit(cwd, ["rev-parse", "--git-common-dir"]);
    const commonDir = result.stdout.trim().replace(/\\/g, "/");
    if (commonDir) {
      return normalizeQueueRoot(resolvePath(cwd, commonDir));
    }
  } catch {
    // fall through to toplevel
  }
  try {
    return normalizeQueueRoot(await resolveGitRoot(cwd));
  } catch {
    return normalizeQueueRoot(cwd);
  }
}

function normalizeQueueRoot(path: string) {
  return resolvePath(path).replace(/\\/g, "/").replace(/\/+$/u, "").toLowerCase();
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
  await ensureManagedWorktreesExcluded(gitRoot);
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

async function ensureManagedWorktreesExcluded(gitRoot: string): Promise<void> {
  const excludeResult = await runGit(gitRoot, ["rev-parse", "--git-path", "info/exclude"]);
  const excludePath = resolvePath(gitRoot, excludeResult.stdout.trim());
  let content = "";
  try {
    content = await readFile(excludePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    await mkdir(dirname(excludePath), { recursive: true });
  }
  const alreadyExcluded = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .some((line) => line === ".worktrees" || line === ".worktrees/");
  if (alreadyExcluded) {
    return;
  }
  const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  await appendFile(excludePath, `${separator}.worktrees/\n`, "utf8");
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

export async function getProjectGitStatus(
  cwd: string,
  options?: { refreshRemote?: boolean; remoteConfirmed?: boolean },
): Promise<GitStatusSnapshot> {
  const gitRoot = await resolveGitRoot(cwd);

  // Refresh remote refs first so tracking reads fresh fetched data.
  const refresh = options?.refreshRemote
    ? await refreshTrackingRemoteIfConfigured(gitRoot)
    : { trackingStale: undefined as boolean | undefined, remoteRefreshError: undefined as string | undefined };

  const tracking = await readGitTrackingState(gitRoot);

  // Status porcelain output
  const statusResult = await runGit(gitRoot, ["status", "--porcelain=v1", "-z"]);
  const statusOutput = statusResult.stdout;

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

  let detailedFiles: typeof files = files;
  if (!clean) {
    // Stats only — patch bodies are fetched on demand via project/git/file_diff.
    const gitDiffStats = await readWorktreeGitDiffStats(cwd);
    const statsByPath = new Map(
      gitDiffStats.map((file) => [normalizeDiffPath(file.path), file] as const),
    );

    detailedFiles = files.map((file) => {
      const detail = statsByPath.get(normalizeDiffPath(file.path));
      return {
        ...file,
        additions: detail?.additions ?? 0,
        deletions: detail?.deletions ?? 0,
      };
    });
  }

  // Determine tracking staleness.
  // - detached / no-upstream => not stale (we cannot know remote state)
  // - explicit refresh that failed => stale with error
  // - upstream present but remote not yet confirmed via refresh or push/pull => stale
  let trackingStale: boolean;
  if (tracking.detached || !tracking.upstreamBranch) {
    trackingStale = false;
  } else if (refresh.trackingStale === true) {
    trackingStale = true;
  } else if (options?.remoteConfirmed) {
    trackingStale = false;
  } else if (options?.refreshRemote) {
    // refresh ran and succeeded without error => confirmed
    trackingStale = Boolean(refresh.remoteRefreshError);
  } else {
    trackingStale = true;
  }

  const remoteRefreshError = trackingStale ? refresh.remoteRefreshError : undefined;

  return {
    branch: tracking.branch,
    detached: tracking.detached,
    upstreamBranch: tracking.upstreamBranch,
    ahead: tracking.ahead,
    behind: tracking.behind,
    pushTarget: tracking.pushTarget,
    trackingStale,
    ...(remoteRefreshError ? { remoteRefreshError } : {}),
    clean,
    files: detailedFiles,
  };
}

export interface GitStatusSnapshot {
  branch: string;
  detached: boolean;
  upstreamBranch?: string;
  ahead: number;
  behind: number;
  pushTarget?: string;
  trackingStale: boolean;
  remoteRefreshError?: string;
  clean: boolean;
  files: Array<{
    path: string;
    indexStatus: string;
    worktreeStatus: string;
    originalPath?: string;
    additions?: number;
    deletions?: number;
    patch?: string;
  }>;
}

export function emptyGitSnapshot(): GitStatusSnapshot {
  return {
    branch: "",
    detached: false, // only set true when Git confirms detached HEAD
    upstreamBranch: undefined,
    ahead: 0,
    behind: 0,
    pushTarget: undefined,
    trackingStale: false,
    remoteRefreshError: undefined,
    clean: false,
    files: [],
  };
}

async function listGitRemotes(gitRoot: string): Promise<string[]> {
  try {
    const result = await runGit(gitRoot, ["remote"]);
    return result.stdout
      .split(/\r?\n/u)
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function refreshTrackingRemoteIfConfigured(gitRoot: string): Promise<{
  trackingStale?: boolean;
  remoteRefreshError?: string;
}> {
  const remotes = await listGitRemotes(gitRoot);
  if (remotes.length === 0) {
    return { trackingStale: false };
  }

  let upstreamRemote: string | undefined;
  try {
    const upstream = await runGit(gitRoot, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{u}",
    ]);
    const upstreamRef = upstream.stdout.trim();
    if (upstreamRef && upstreamRef.includes("/")) {
      upstreamRemote = upstreamRef.split("/")[0];
    }
  } catch {
    // no upstream; fall through to fetch --all
  }

  try {
    if (upstreamRemote) {
      await runGit(gitRoot, ["fetch", upstreamRemote]);
    } else {
      await runGit(gitRoot, ["fetch", "--all"]);
    }
    return { trackingStale: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "git fetch failed";
    // execFile rejects with an object carrying stderr
    const stderr = (error as { stderr?: string })?.stderr;
    const detail = (stderr ?? message).trim();
    return { trackingStale: true, remoteRefreshError: detail || message };
  }
}

async function readGitTrackingState(gitRoot: string): Promise<{
  branch: string;
  detached: boolean;
  upstreamBranch?: string;
  ahead: number;
  behind: number;
  pushTarget?: string;
}> {
  // Detect detached HEAD via symbolic-ref (fails when detached).
  let branch: string;
  let detached = false;
  try {
    const branchResult = await runGit(gitRoot, ["symbolic-ref", "--short", "HEAD"]);
    branch = branchResult.stdout.trim();
  } catch {
    detached = true;
    const hashResult = await runGit(gitRoot, ["rev-parse", "--short", "HEAD"]);
    branch = hashResult.stdout.trim();
  }

  if (detached) {
    return { branch, detached: true, ahead: 0, behind: 0, pushTarget: undefined };
  }

  // Resolve upstream `remote/branch` if present.
  let upstreamBranch: string | undefined;
  try {
    const upstreamResult = await runGit(gitRoot, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{u}",
    ]);
    upstreamBranch = upstreamResult.stdout.trim() || undefined;
  } catch {
    upstreamBranch = undefined;
  }

  let ahead = 0;
  let behind = 0;
  if (upstreamBranch) {
    try {
      const aheadResult = await runGit(gitRoot, ["rev-list", "--count", "@{u}..HEAD"]);
      ahead = Number.parseInt(aheadResult.stdout.trim(), 10) || 0;
    } catch {
      ahead = 0;
    }
    try {
      const behindResult = await runGit(gitRoot, ["rev-list", "--count", "HEAD..@{u}"]);
      behind = Number.parseInt(behindResult.stdout.trim(), 10) || 0;
    } catch {
      behind = 0;
    }
  }

  // Compute pushTarget.
  const pushTarget = await resolvePushTarget(gitRoot, branch, upstreamBranch, detached);

  return { branch, detached, upstreamBranch, ahead, behind, pushTarget };
}

async function resolvePushTarget(
  gitRoot: string,
  branch: string,
  upstreamBranch: string | undefined,
  detached: boolean,
): Promise<string | undefined> {
  if (detached || !branch) {
    return undefined;
  }
  if (upstreamBranch) {
    return upstreamBranch;
  }
  const remotes = await listGitRemotes(gitRoot);
  if (remotes.length === 0) {
    return undefined;
  }
  if (remotes.includes("origin")) {
    return `origin/${branch}`;
  }
  if (remotes.length === 1) {
    return `${remotes[0]}/${branch}`;
  }
  return undefined;
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
  validateGitPaths(gitRoot, paths);

  const originalIndexTree = (await runGit(gitRoot, ["write-tree"])).stdout.trim();
  let commitResult: Awaited<ReturnType<typeof runGit>>;
  try {
    // Stage only the specified paths.
    await runGit(gitRoot, ["add", "--", ...paths]);

    // Commit only the requested paths. A plain `git commit` would also include
    // unrelated changes that were already staged outside Tiller.
    commitResult = await runGit(gitRoot, [
      "commit",
      "--only",
      "-m",
      trimmedMessage,
      "--",
      ...paths,
    ]);
  } catch (error) {
    // Tiller does not expose the index as user-facing state, so a failed
    // commit must not leave the selected paths staged behind the user's back.
    await runGit(gitRoot, ["read-tree", originalIndexTree]);
    throw error;
  }

  // Extract commit hash from output
  const hashMatch = /\[.+\s+([a-f0-9]{7,40})\]/u.exec(commitResult.stdout);
  const commitHash = hashMatch?.[1];

  // Get updated status (remote not confirmed after commit)
  const status = await getProjectGitStatus(gitRoot, { remoteConfirmed: false });

  return { commitHash, status };
}

export async function discardProjectGitChanges(
  cwd: string,
  selectedPaths: string[],
): Promise<GitStatusSnapshot> {
  const gitRoot = await resolveGitRoot(cwd);

  const paths = Array.from(new Set(selectedPaths));
  if (paths.length === 0) {
    throw new Error("At least one selected path is required");
  }
  validateGitPaths(gitRoot, paths);
  validateDiscardPaths(gitRoot, paths);

  const currentStatus = await getProjectGitStatus(gitRoot, { remoteConfirmed: false });
  const statusByPath = new Map(
    currentStatus.files.map((file) => [normalizeDiffPath(file.path), file] as const),
  );
  const expandedPaths = Array.from(new Set(paths.flatMap((path) => {
    const originalPath = statusByPath.get(normalizeDiffPath(path))?.originalPath;
    return originalPath ? [path, originalPath] : [path];
  })));

  // Reset the selected index entries first. This makes newly-added paths
  // untracked while restoring the HEAD version for existing tracked paths.
  await runGit(gitRoot, ["reset", "--quiet", "HEAD", "--", ...expandedPaths]);

  const trackedResult = await runGit(gitRoot, ["ls-files", "-z", "--", ...expandedPaths]);
  const trackedPaths = trackedResult.stdout.split("\0").filter(Boolean);
  if (trackedPaths.length > 0) {
    await runGit(gitRoot, ["restore", "--worktree", "--", ...trackedPaths]);
  }

  // Remove only now-untracked entries inside the explicit path scope.
  await runGit(gitRoot, ["clean", "-fd", "--", ...expandedPaths]);
  return getProjectGitStatus(gitRoot, { remoteConfirmed: false });
}

function validateGitPaths(gitRoot: string, paths: string[]) {
  const resolvedGitRoot = resolvePath(gitRoot);
  const gitRootWithSeparator = `${resolvedGitRoot}${sep}`;
  for (const path of paths) {
    const resolvedPath = resolvePath(gitRoot, path);
    if (resolvedPath !== resolvedGitRoot && !resolvedPath.startsWith(gitRootWithSeparator)) {
      throw new Error(`Path ${path} is outside git repository`);
    }
  }
}

function validateDiscardPaths(gitRoot: string, paths: string[]) {
  for (const path of paths) {
    const repositoryPath = normalizeDiffPath(relative(gitRoot, resolvePath(gitRoot, path)));
    if (repositoryPath === ".worktrees" || repositoryPath.startsWith(".worktrees/")) {
      throw new Error("Managed worktree paths cannot be discarded");
    }
  }
}

export async function pushProjectGitChanges(cwd: string): Promise<GitStatusSnapshot> {
  const gitRoot = await resolveGitRoot(cwd);

  const tracking = await readGitTrackingState(gitRoot);

  if (tracking.detached) {
    throw new Error("Cannot push: HEAD is detached");
  }

  const { branch, upstreamBranch, pushTarget } = tracking;

  if (upstreamBranch) {
    await runGit(gitRoot, ["push"]);
  } else if (pushTarget) {
    // Publish to inferred target (origin/<branch> or sole remote/<branch>)
    const [remote] = pushTarget.split("/");
    await runGit(gitRoot, ["push", "-u", remote!, branch]);
  } else {
    throw new Error("Cannot push: no upstream configured and no single remote to publish to");
  }

  return getProjectGitStatus(gitRoot, { remoteConfirmed: true });
}

export async function pullProjectGitChanges(cwd: string): Promise<GitStatusSnapshot> {
  const gitRoot = await resolveGitRoot(cwd);

  const tracking = await readGitTrackingState(gitRoot);

  if (tracking.detached) {
    throw new Error("Cannot pull: HEAD is detached");
  }
  if (!tracking.upstreamBranch) {
    throw new Error("Cannot pull: no upstream branch configured");
  }

  // Check worktree is clean.
  const statusResult = await runGit(gitRoot, ["status", "--porcelain=v1", "-z"]);
  if (statusResult.stdout.length > 0) {
    const entries = statusResult.stdout.split("\0").filter((entry) => entry.length >= 3);
    if (entries.length > 0) {
      throw new Error("Cannot pull: dirty worktree");
    }
  }

  await runGit(gitRoot, ["pull", "--ff-only"]);

  return getProjectGitStatus(gitRoot, { remoteConfirmed: true });
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

export interface GitCommitFile {
  path: string;
  originalPath?: string;
  status: "modified" | "added" | "deleted";
  additions: number;
  deletions: number;
  patch?: string;
}

export async function getProjectGitCommitDetail(
  cwd: string,
  commitHash: string,
): Promise<{ commitHash: string; files: GitCommitFile[] }> {
  if (!/^[0-9a-f]{7,64}$/iu.test(commitHash)) {
    throw new Error("Invalid commit hash");
  }

  const gitRoot = await resolveGitRoot(cwd);
  const resolved = await runGit(gitRoot, ["rev-parse", "--verify", `${commitHash}^{commit}`]);
  const resolvedHash = resolved.stdout.trim();
  const parents = await runGit(gitRoot, ["rev-list", "--parents", "-n", "1", resolvedHash]);
  const firstParent = parents.stdout.trim().split(/\s+/u)[1];
  const changed = firstParent
    ? await runGit(gitRoot, [
        "diff",
        "--name-status",
        "-z",
        "--find-renames",
        firstParent,
        resolvedHash,
      ])
    : await runGit(gitRoot, [
        "diff-tree",
        "--root",
        "--no-commit-id",
        "--name-status",
        "-r",
        "-z",
        "--find-renames",
        resolvedHash,
      ]);
  const entries = parseCommitFileEntries(changed.stdout);
  // Per-file patch reads are independent read-only commands; run them concurrently.
  const files: GitCommitFile[] = await Promise.all(entries.map(async (entry) => {
    const patchResult = await runGit(
      gitRoot,
      firstParent
        ? [
            "diff",
            "--find-renames",
            "--no-ext-diff",
            "--no-color",
            "--unified=3",
            firstParent,
            resolvedHash,
            "--",
            entry.path,
          ]
        : [
            "show",
            "--format=",
            "--find-renames",
            "--no-ext-diff",
            "--no-color",
            "--unified=3",
            resolvedHash,
            "--",
            entry.path,
          ],
    );
    const patch = patchResult.stdout.trimEnd();
    return {
      ...entry,
      ...countPatchChanges(patch),
      ...(patch ? { patch } : {}),
    };
  }));

  return { commitHash: resolvedHash, files };
}

function parseCommitFileEntries(output: string): Array<
  Pick<GitCommitFile, "path" | "originalPath" | "status">
> {
  const tokens = output.split("\0").filter(Boolean);
  const entries: Array<Pick<GitCommitFile, "path" | "originalPath" | "status">> = [];
  for (let index = 0; index < tokens.length;) {
    const code = tokens[index++] ?? "";
    const firstPath = tokens[index++];
    if (!firstPath) {
      break;
    }
    if (code.startsWith("R") || code.startsWith("C")) {
      const path = tokens[index++];
      if (path) {
        entries.push({ path, originalPath: firstPath, status: "modified" });
      }
      continue;
    }
    entries.push({
      path: firstPath,
      status: code.startsWith("A")
        ? "added"
        : code.startsWith("D")
          ? "deleted"
          : "modified",
    });
  }
  return entries;
}

function countPatchChanges(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split(/\r?\n/u)) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      additions += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deletions += 1;
    }
  }
  return { additions, deletions };
}

export async function getProjectGitFileDiffs(cwd: string, paths: string[]) {
  const gitRoot = await resolveGitRoot(cwd);
  return readWorktreeGitFileDiffs(gitRoot, paths);
}

export async function getProjectGitGraph(cwd: string, knownSignature?: string) {
  const gitRoot = await resolveGitRoot(cwd);

  // Get current HEAD hash
  let head: string | undefined;
  try {
    const headResult = await runGit(gitRoot, ["rev-parse", "HEAD"]);
    head = headResult.stdout.trim();
  } catch {
    // Detached or no HEAD, will be handled
  }

  // Signature over HEAD + all refs: any ref movement (including remote refs
  // after a fetch) must invalidate it, not just HEAD changes.
  const signature = createHash("sha1")
    .update(`${head ?? ""}\n${await readGitRefsSnapshot(gitRoot)}`)
    .digest("hex");
  if (knownSignature && knownSignature === signature) {
    return { head, commits: [] as GitCommit[], signature, unchanged: true as const };
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
    `--max-count=${GIT_GRAPH_INITIAL_COMMIT_LIMIT}`,
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

  return { head, commits, signature, unchanged: false as const };
}

async function readGitRefsSnapshot(gitRoot: string) {
  try {
    const refs = await runGit(gitRoot, [
      "for-each-ref",
      "--format=%(refname)%00%(objectname)",
    ]);
    return refs.stdout;
  } catch {
    return "";
  }
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
