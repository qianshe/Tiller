import type { FileDiffSummary } from "@tiller/shared";

export type DashboardGitMobilePane = "changes" | "detail" | "history";

export function resolveDashboardGitSelectedFilePath(
  selectedPath: string | null,
  files: FileDiffSummary[],
) {
  if (!selectedPath) return null;
  return files.some((file) => file.path === selectedPath) ? selectedPath : null;
}

export function resolveDashboardGitMobilePane(
  activePane: Exclude<DashboardGitMobilePane, "history">,
  historyOpen: boolean,
): DashboardGitMobilePane {
  return historyOpen ? "history" : activePane;
}
