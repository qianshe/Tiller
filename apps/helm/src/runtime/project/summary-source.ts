import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { ProjectSummary, WorktreeSummary } from "@tiller/shared";

export const DEFAULT_PROJECT_SUMMARY_FILES = ["AGENTS.md", "CLAUDE.md", "README.md"] as const;

type LoadProjectSummarySourceInput = {
  project: ProjectSummary;
  worktrees: WorktreeSummary[];
};

export type ProjectSummarySource = {
  path: string;
  content: string;
};

export async function loadProjectSummarySource(
  input: LoadProjectSummarySourceInput,
): Promise<ProjectSummarySource | undefined> {
  const root = resolveProjectSummaryRoot(input.project, input.worktrees);
  if (!root) {
    return configuredSummarySource(input.project.summary);
  }

  const candidates = [
    input.project.summaryFile,
    ...DEFAULT_PROJECT_SUMMARY_FILES,
  ].filter((path): path is string => Boolean(path?.trim()));

  for (const candidate of candidates) {
    const safePath = normalizeSummaryFilePath(candidate);
    if (!safePath) {
      continue;
    }

    const absolutePath = resolve(root, safePath);
    if (!isWithinRoot(root, absolutePath)) {
      continue;
    }

    try {
      const content = (await readFile(absolutePath, "utf8")).trim();
      if (content) {
        return { path: safePath, content };
      }
    } catch {
      continue;
    }
  }

  return configuredSummarySource(input.project.summary);
}

function resolveProjectSummaryRoot(project: ProjectSummary, worktrees: WorktreeSummary[]) {
  return project.path ?? worktrees.find((worktree) => worktree.kind === "root")?.path ?? worktrees[0]?.path;
}

function normalizeSummaryFilePath(path: string) {
  const slashed = path.replace(/\\/gu, "/").trim();
  if (!slashed || slashed.startsWith("/") || /^[a-zA-Z]:\//u.test(slashed)) {
    return undefined;
  }
  const normalized = slashed.replace(/^\/+/, "");
  if (normalized.split("/").some((part) => part === "..")) {
    return undefined;
  }
  return normalized;
}

function isWithinRoot(root: string, child: string) {
  const relativePath = relative(resolve(root), child);
  return Boolean(relativePath) && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

function configuredSummarySource(summary: string | undefined) {
  return summary ? { path: "<configured-summary>", content: summary } : undefined;
}
