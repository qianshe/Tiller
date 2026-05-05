import type { ProjectFileSummary } from "@tiller/shared";
import type { MissionPanelPage } from "../ui/panels";

export function buildMissionPanelPages(
  diffCount: number,
  logCount: number,
  customPages: MissionPanelPage[],
): MissionPanelPage[] {
  return [
    { id: "overview", title: "概览" },
    { id: "changes", title: `Git Diff (${diffCount})` },
    { id: "diff-detail", title: "Diff 详情" },
    { id: "logbook", title: `航行日志 (${logCount})` },
    ...customPages,
  ];
}

export function selectMissionPanelPage(
  pages: MissionPanelPage[],
  selectedPageId: string,
): MissionPanelPage {
  return pages.find((page) => page.id === selectedPageId) ?? pages[0]!;
}

export function resolveVisibleProjectFiles(
  projectFiles: ProjectFileSummary[],
  filter: string,
  collapsedDirectories: Set<string>,
) {
  const filterText = filter.trim().toLowerCase();
  return projectFiles.filter((file) => {
    if (filterText) {
      return file.path.toLowerCase().includes(filterText);
    }
    const parts = file.path.split("/");
    return !parts
      .slice(1)
      .some((_, index) =>
        collapsedDirectories.has(parts.slice(0, index + 1).join("/")),
      );
  });
}

export function joinClassNames(parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
