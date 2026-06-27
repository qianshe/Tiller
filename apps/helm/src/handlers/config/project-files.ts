import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { sortProjectFileSummaries } from "@tiller/shared";
import type { ProjectFileSummary, ProjectSummary, WorktreeSummary } from "@tiller/shared";

const execFileAsync = promisify(execFile);
const GIT_COMMAND_TIMEOUT_MS = 8000;
const PROJECT_FILES_MAX_BUFFER = 8 * 1024 * 1024;
const PROJECT_FILE_FALLBACK_LIMIT = 5000;
const PROJECT_DIRECTORY_SUGGESTION_LIMIT = 80;
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
  worktrees: WorktreeSummary[],
  cwd?: string,
) {
  if (cwd?.trim()) {
    return cwd.trim();
  }
  return project.path ?? worktrees[0]?.path;
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

export async function listProjectDirectories(inputPath: string | undefined) {
  const query = inputPath?.trim();
  if (!query) {
    return {
      path: undefined,
      directories: [],
      message: "Enter a path to list directories",
    };
  }

  const search = await resolveDirectorySearch(query);
  const entries = await readdir(search.basePath, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => entry.name.toLowerCase().startsWith(search.filter.toLowerCase()))
    .map((entry) => normalizeAbsoluteProjectPath(resolve(search.basePath, entry.name)))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, PROJECT_DIRECTORY_SUGGESTION_LIMIT);

  return {
    path: normalizeAbsoluteProjectPath(search.basePath),
    directories,
    message: `Loaded ${directories.length} directories`,
  };
}

async function resolveDirectorySearch(query: string) {
  const resolved = resolve(query);
  try {
    const info = await stat(resolved);
    if (info.isDirectory()) {
      return { basePath: resolved, filter: "" };
    }
  } catch {
    // Treat missing input as a partial child path under its parent.
  }
  return { basePath: dirname(resolved), filter: basename(resolved) };
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
      if (IGNORED_PROJECT_FILE_DIRECTORIES.has(entry.name)) {
        continue;
      }
      const absolute = resolve(directory, entry.name);
      const relativePath = normalizeProjectFilePath(absolute.slice(root.length + 1));
      if (!relativePath) {
        continue;
      }
      if (entry.isDirectory()) {
        files.push({ path: relativePath, kind: "directory" });
        await walk(absolute);
      } else if (entry.isFile()) {
        files.push({ path: relativePath, kind: "file" });
      }
    }
  }

  await walk(root);
  return files.sort(sortProjectFileSummaries);
}

export async function resolveGitRoot(cwd: string) {
  const result = await execFileAsync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
    timeout: GIT_COMMAND_TIMEOUT_MS,
    windowsHide: true,
  });
  return result.stdout.trim().replace(/\\/g, "/");
}

function normalizeProjectFilePath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function normalizeAbsoluteProjectPath(path: string) {
  const slashed = path.replace(/\\/g, "/");
  if (slashed === "/" || /^[a-zA-Z]:\/$/u.test(slashed)) {
    return slashed;
  }
  return slashed.replace(/\/+$/g, "");
}

function isNonGitRepositoryError(error: unknown) {
  return error instanceof Error && /not a git repository|not a git repo|fatal:/iu.test(error.message);
}
