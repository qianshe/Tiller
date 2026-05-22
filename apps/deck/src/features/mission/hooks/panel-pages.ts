import { useEffect, useState } from "react";
import type { MissionPanelPage } from "../ui/panels";
import {
  moveMissionPanelPageInList,
  readMissionPanelPages,
  reorderMissionPanelPage,
  writeMissionPanelPages,
} from "../utils/panel-pages";

/**
 * Owns custom mission display pages, selected page, diff focus and tree collapse state.
 */
export function usePanelPages() {
  const [customPages, setCustomPages] = useState<MissionPanelPage[]>(() =>
    readMissionPanelPages(),
  );
  const [selectedPageId, setSelectedPageId] = useState("overview");
  const [openedDiffFilePaths, setOpenedDiffFilePaths] = useState<string[]>([]);
  const [selectedDiffFilePath, setSelectedDiffFilePath] = useState<
    string | null
  >(null);
  const [collapsedDiffDirectories, setCollapsedDiffDirectories] = useState<
    Set<string>
  >(() => new Set());
  const [draggedPageId, setDraggedPageId] = useState<string | null>(null);

  useEffect(() => {
    writeMissionPanelPages(customPages);
  }, [customPages]);

  function toggleDiffDirectory(path: string) {
    setCollapsedDiffDirectories((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  function addPage() {
    const id = `custom-${Date.now()}`;
    setCustomPages((current) => [
      ...current,
      { id, title: `展示页 ${current.length + 1}` },
    ]);
    setSelectedPageId(id);
  }

  function dropPage(targetPageId: string) {
    if (!draggedPageId || draggedPageId === targetPageId) {
      return;
    }
    setCustomPages((current) =>
      reorderMissionPanelPage(current, draggedPageId, targetPageId),
    );
    setDraggedPageId(null);
  }

  function renamePage(pageId: string, title: string) {
    setCustomPages((current) =>
      current.map((page) => (page.id === pageId ? { ...page, title } : page)),
    );
  }

  function movePage(pageId: string, direction: -1 | 1) {
    setCustomPages((current) =>
      moveMissionPanelPageInList(current, pageId, direction),
    );
  }

  function deletePage(pageId: string) {
    setCustomPages((current) => current.filter((page) => page.id !== pageId));
    if (selectedPageId === pageId) {
      setSelectedPageId("overview");
    }
  }

  function openDiffFile(path: string) {
    setOpenedDiffFilePaths((current) =>
      current.includes(path) ? current : [...current, path],
    );
    setSelectedDiffFilePath(path);
    setSelectedPageId("diff-detail");
  }

  function closeDiffFile(path: string) {
    setOpenedDiffFilePaths((current) => {
      const next = current.filter((item) => item !== path);
      if (selectedDiffFilePath === path) {
        setSelectedDiffFilePath(next.at(-1) ?? null);
      }
      return next;
    });
  }

  return {
    customPages,
    selectedPageId,
    setSelectedPageId,
    openedDiffFilePaths,
    selectedDiffFilePath,
    setSelectedDiffFilePath,
    collapsedDiffDirectories,
    setDraggedPageId,
    toggleDiffDirectory,
    addPage,
    dropPage,
    renamePage,
    movePage,
    deletePage,
    openDiffFile,
    closeDiffFile,
  };
}
