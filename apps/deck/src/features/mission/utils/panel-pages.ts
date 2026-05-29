import { isRecord } from "../../preferences";
import type { MissionPanelPage } from "../display/panels";

const MISSION_PANEL_PAGES_STORAGE_KEY = "tiller.mission-panel-pages";

export function readMissionPanelPages(): MissionPanelPage[] {
  try {
    const raw = window.localStorage.getItem(MISSION_PANEL_PAGES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(isRecord).map((page, index) => ({
          id:
            typeof page.id === "string" && page.id
              ? page.id
              : `custom-${index + 1}`,
          title:
            typeof page.title === "string" && page.title
              ? page.title
              : `展示页 ${index + 1}`,
        }))
      : [];
  } catch {
    return [];
  }
}

export function writeMissionPanelPages(pages: MissionPanelPage[]) {
  window.localStorage.setItem(
    MISSION_PANEL_PAGES_STORAGE_KEY,
    JSON.stringify(pages),
  );
}

export function moveMissionPanelPageInList(
  pages: MissionPanelPage[],
  pageId: string,
  direction: -1 | 1,
) {
  const index = pages.findIndex((page) => page.id === pageId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= pages.length) return pages;
  const next = [...pages];
  const [page] = next.splice(index, 1);
  if (!page) return pages;
  next.splice(nextIndex, 0, page);
  return next;
}

export function reorderMissionPanelPage(
  pages: MissionPanelPage[],
  sourceId: string,
  targetId: string,
) {
  const sourceIndex = pages.findIndex((page) => page.id === sourceId);
  const targetIndex = pages.findIndex((page) => page.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return pages;
  const next = [...pages];
  const [page] = next.splice(sourceIndex, 1);
  if (!page) return pages;
  next.splice(targetIndex, 0, page);
  return next;
}
