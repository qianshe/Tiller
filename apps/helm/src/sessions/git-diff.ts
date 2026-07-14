import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { FileDiffSummary } from "@tiller/shared";

const GIT_DIFF_MAX_BUFFER = 16 * 1024 * 1024;
const MAX_UNTRACKED_PATCH_BYTES = 4 * 1024 * 1024;
const UNTRACKED_READ_CONCURRENCY = 4;

/**
 * Uses one tracked diff process and one untracked-file listing process per
 * hydration. Per-file Git processes are intentionally forbidden here.
 */
export async function readWorktreeGitDiffs(cwd: string): Promise<FileDiffSummary[]> {
  try {
    const [trackedResult, untrackedResult] = await Promise.all([
      readGitProcess(cwd, ["diff", "--no-ext-diff", "--find-renames=0", "--patch", "HEAD", "--"]),
      readGitProcess(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]),
    ]);
    const trackedDiffs = parseGitPatchSet(trackedResult);
    const untrackedPaths = untrackedResult.split("\0").filter(Boolean);
    const untrackedDiffs = await mapWithConcurrency(
      untrackedPaths,
      UNTRACKED_READ_CONCURRENCY,
      (filePath) => buildUntrackedFileDiff(cwd, filePath),
    );
    return [...trackedDiffs, ...untrackedDiffs];
  } catch {
    return [];
  }
}

function readGitProcess(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolveResult, reject) => {
    const child = spawn("git", ["-C", cwd, ...args], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      callback();
    };
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > GIT_DIFF_MAX_BUFFER) {
        child.kill();
        finish(() => reject(new Error("Git diff output exceeded the 16 MiB limit.")));
        return;
      }
      chunks.push(chunk);
    });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => {
      if (code !== 0) {
        finish(() => reject(new Error(`Git exited with code ${code ?? "unknown"}.`)));
        return;
      }
      finish(() => resolveResult(Buffer.concat(chunks).toString("utf8")));
    });
  });
}

function parseGitPatchSet(output: string): FileDiffSummary[] {
  return output
    .split(/(?=^diff --git )/mu)
    .map((patch) => patch.trimEnd())
    .filter(Boolean)
    .map((patch): FileDiffSummary | undefined => {
      const path = resolvePatchPath(patch);
      if (!path) {
        return undefined;
      }
      return {
        path,
        status: patch.includes("new file mode")
          ? "added" as const
          : patch.includes("deleted file mode")
            ? "deleted" as const
            : "modified" as const,
        additions: countPatchLines(patch, "+"),
        deletions: countPatchLines(patch, "-"),
        patch,
      };
    })
    .filter((diff): diff is FileDiffSummary => Boolean(diff));
}

function resolvePatchPath(patch: string) {
  const added = /^\+\+\+ b\/(.+)$/mu.exec(patch)?.[1];
  const deleted = /^--- a\/(.+)$/mu.exec(patch)?.[1];
  return normalizeDiffPath(unquoteGitPath(added ?? deleted ?? ""));
}

function unquoteGitPath(value: string) {
  return value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1).replaceAll("\\\"", '"').replaceAll("\\\\", "\\")
    : value;
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
    const fileStat = await stat(absoluteFile);
    if (fileStat.size > MAX_UNTRACKED_PATCH_BYTES) {
      return {
        path: filePath,
        status: "added",
        additions: 0,
        deletions: 0,
        patchTruncated: true,
      };
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

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  map: (value: T) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) {
        return;
      }
      results[index] = await map(values[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
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
