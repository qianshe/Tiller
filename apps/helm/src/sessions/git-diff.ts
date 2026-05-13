import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { FileDiffSummary } from "@tiller/shared";

const execFileAsync = promisify(execFile);
const GIT_DIFF_MAX_BUFFER = 5 * 1024 * 1024;

export async function readWorktreeGitDiffs(cwd: string): Promise<FileDiffSummary[]> {
  try {
    const [nameStatusResult, numstatResult] = await Promise.all([
      execFileAsync("git", ["-C", cwd, "diff", "--name-status", "HEAD", "--"], {
        maxBuffer: GIT_DIFF_MAX_BUFFER,
      }),
      execFileAsync("git", ["-C", cwd, "diff", "--numstat", "HEAD", "--"], {
        maxBuffer: GIT_DIFF_MAX_BUFFER,
      }),
    ]);
    const statsByPath = parseGitNumstat(numstatResult.stdout);
    const files = parseGitNameStatus(nameStatusResult.stdout);
    const trackedDiffs = await Promise.all(
      files.map(async (file) => {
        const stats = statsByPath.get(normalizeDiffPath(file.path));
        const patch = await readWorktreeGitPatch(cwd, file.path);
        return {
          ...file,
          additions: stats?.additions ?? countPatchLines(patch, "+"),
          deletions: stats?.deletions ?? countPatchLines(patch, "-"),
          ...(patch ? { patch } : {}),
        };
      }),
    );
    const untrackedDiffs = await readWorktreeUntrackedDiffs(cwd);
    return [...trackedDiffs, ...untrackedDiffs];
  } catch {
    return [];
  }
}

async function readWorktreeGitPatch(cwd: string, filePath: string) {
  try {
    const result = await execFileAsync(
      "git",
      ["-C", cwd, "diff", "--no-ext-diff", "HEAD", "--", filePath],
      { maxBuffer: GIT_DIFF_MAX_BUFFER },
    );
    const patch = result.stdout.trimEnd();
    return patch || undefined;
  } catch {
    return undefined;
  }
}

async function readWorktreeUntrackedDiffs(cwd: string): Promise<FileDiffSummary[]> {
  try {
    const result = await execFileAsync(
      "git",
      ["-C", cwd, "ls-files", "--others", "--exclude-standard", "-z"],
      { maxBuffer: GIT_DIFF_MAX_BUFFER },
    );
    const files = result.stdout.split("\0").filter(Boolean);
    return Promise.all(files.map((filePath) => buildUntrackedFileDiff(cwd, filePath)));
  } catch {
    return [];
  }
}

async function buildUntrackedFileDiff(
  cwd: string,
  filePath: string,
): Promise<FileDiffSummary> {
  try {
    const absoluteWorktree = resolve(cwd);
    const absoluteFile = resolve(absoluteWorktree, filePath);
    if (
      absoluteFile !== absoluteWorktree &&
      !absoluteFile.startsWith(`${absoluteWorktree}${sep}`)
    ) {
      return { path: filePath, status: "added", additions: 0, deletions: 0 };
    }

    const content = await readFile(absoluteFile, "utf8");
    const patch = buildAddedFilePatch(filePath, content);
    return {
      path: filePath,
      status: "added",
      additions: countPatchLines(patch, "+"),
      deletions: 0,
      patch,
    };
  } catch {
    return { path: filePath, status: "added", additions: 0, deletions: 0 };
  }
}

function buildAddedFilePatch(filePath: string, content: string) {
  const normalizedContent = content.replace(/\r\n/g, "\n");
  const lines = normalizedContent ? normalizedContent.replace(/\n$/u, "").split("\n") : [];
  const body = lines.map((line) => `+${line}`).join("\n");
  return [
    `diff --git a/${filePath} b/${filePath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    body,
  ]
    .filter(Boolean)
    .join("\n");
}

function parseGitNameStatus(output: string): FileDiffSummary[] {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [statusToken = "M", ...paths] = line.split(/\t+/u);
      const path = paths.at(-1) ?? "";
      return {
        path,
        status: statusToken.startsWith("A")
          ? ("added" as const)
          : statusToken.startsWith("D")
            ? ("deleted" as const)
            : ("modified" as const),
        additions: 0,
        deletions: 0,
      };
    })
    .filter((file) => Boolean(file.path));
}

function parseGitNumstat(output: string) {
  const stats = new Map<string, { additions: number; deletions: number }>();
  for (const line of output.split(/\r?\n/u)) {
    const [additionsRaw, deletionsRaw, ...paths] = line.split(/\t+/u);
    const path = paths.at(-1);
    if (!path) {
      continue;
    }
    stats.set(normalizeDiffPath(path), {
      additions: parseGitStatNumber(additionsRaw),
      deletions: parseGitStatNumber(deletionsRaw),
    });
  }
  return stats;
}

function parseGitStatNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeDiffPath(path: string) {
  return path.replace(/\\/g, "/");
}

function countPatchLines(patch: string | undefined, marker: "+" | "-") {
  if (!patch) {
    return 0;
  }

  const ignoredPrefix = marker === "+" ? "+++" : "---";
  return patch
    .split(/\r?\n/u)
    .filter((line) => line.startsWith(marker) && !line.startsWith(ignoredPrefix)).length;
}
