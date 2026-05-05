import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { promisify } from "node:util";
import { sortProjectFileSummaries } from "@tiller/shared";
import type { ProjectFileSummary, ProjectSummary, WorkspaceSummary } from "@tiller/shared";
import { isProjectRootBranchWorkspace } from "../../sessions/project-binding";

const execFileAsync = promisify(execFile);
const GIT_COMMAND_TIMEOUT_MS = 8000;
const PROJECT_FILES_MAX_BUFFER = 8 * 1024 * 1024;
const PROJECT_FILE_FALLBACK_LIMIT = 5000;
const IGNORED_PROJECT_FILE_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  ".tiller",
  "dist",
  "build",
  ".next",
  "coverage",
]);

export function resolveProjectFileRoot(
  project: ProjectSummary,
  workspaces: WorkspaceSummary[],
  workspaceId?: string,
) {
  const workspace = workspaceId ? workspaces.find((item) => item.id === workspaceId) : undefined;
  if (!workspace || isProjectRootBranchWorkspace(project, workspace)) {
    if (project.path) {
      return project.path;
    }
  }
  return workspace?.path ?? resolveProjectRoot(project, workspaces);
}

export async function listProjectFiles(rootPath: string) {
  try {
    const gitRoot = await resolveGitRoot(rootPath);
    const result = await runGitForProjectFiles(gitRoot);
    const files = buildProjectFileSummaries(
      result.stdout
        .split("\0")
        .map((path) => normalizeProjectFilePath(path.trim()))
        .filter(Boolean),
    );
    return { files, message: `Loaded ${files.length} Git entries` };
  } catch (error) {
    if (!isNonGitRepositoryError(error)) {
      throw error;
    }
    const files = await listProjectFilesFromDirectory(rootPath);
    const truncated = files.length >= PROJECT_FILE_FALLBACK_LIMIT;
    return {
      files,
      message: truncated ? `Loaded first ${files.length} files` : `Loaded ${files.length} files`,
    };
  }
}

async function runGitForProjectFiles(cwd: string) {
  return execFileAsync(
    "git",
    ["-C", cwd, "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      timeout: GIT_COMMAND_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: PROJECT_FILES_MAX_BUFFER,
    },
  );
}

function resolveProjectRoot(project: ProjectSummary, workspaces: WorkspaceSummary[]) {
  if (project.path) {
    return project.path;
  }
  const workspace =
    workspaces.find((item) => item.id === project.defaultWorkspaceId) ??
    workspaces.find((item) => project.workspaceIds?.includes(item.id));
  return workspace?.path;
}

function buildProjectFileSummaries(filePaths: string[]) {
  const directories = new Set<string>();
  const files = new Set<string>();
  filePaths.forEach((filePath) => {
    const normalized = normalizeProjectFilePath(filePath).replace(/\/$/, "");
    if (!normalized) {
      return;
    }
    files.add(normalized);
    const parts = normalized.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join("/"));
    }
  });
  return [
    ...Array.from(directories).map<ProjectFileSummary>((path) => ({ path, kind: "directory" })),
    ...Array.from(files).map<ProjectFileSummary>((path) => ({ path, kind: "file" })),
  ].sort(sortProjectFileSummaries);
}

async function listProjectFilesFromDirectory(rootPath: string) {
  const root = resolve(rootPath);
  const files: ProjectFileSummary[] = [];

  async function walk(directory: string) {
    if (files.length >= PROJECT_FILE_FALLBACK_LIMIT) {
      return;
    }
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= PROJECT_FILE_FALLBACK_LIMIT) {
        return;
      }
      const absolutePath = resolve(directory, entry.name);
      if (!isPathInsideRoot(root, absolutePath)) {
        continue;
      }
      const projectPath = normalizeProjectFilePath(relative(root, absolutePath));
      if (entry.isDirectory()) {
        if (!IGNORED_PROJECT_FILE_DIRECTORIES.has(entry.name)) {
          files.push({ path: projectPath, kind: "directory" });
          await walk(absolutePath);
        }
      } else if (entry.isFile()) {
        files.push({ path: projectPath, kind: "file" });
      }
    }
  }

  await walk(root);
  return files.sort(sortProjectFileSummaries);
}

async function resolveGitRoot(path: string) {
  const result = await execFileAsync("git", ["-C", path, "rev-parse", "--show-toplevel"], {
    timeout: GIT_COMMAND_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return result.stdout.trim() || path;
}

function normalizeProjectFilePath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isPathInsideRoot(root: string, candidate: string) {
  const relativePath = relative(root, candidate);
  return (
    relativePath === "" ||
    (Boolean(relativePath) &&
      !relativePath.startsWith("..") &&
      !resolve(relativePath).startsWith(".."))
  );
}

function isNonGitRepositoryError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /not a git repository|not a git repo|outside repository/i.test(message);
}
