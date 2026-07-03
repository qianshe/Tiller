import { useState } from "react";

/**
 * Owns selected display tab, diff focus and tree collapse state.
 * Display tab state only handles "what is selected".
 * Layout control stays in root/controller layer.
 */
export function usePanelPages() {
  const [selectedDisplayTabId, setSelectedDisplayTabId] = useState("diff-detail");
  const [openedDiffFilePaths, setOpenedDiffFilePaths] = useState<string[]>([]);
  const [selectedDiffFilePath, setSelectedDiffFilePath] = useState<
    string | null
  >(null);
  const [collapsedDiffDirectories, setCollapsedDiffDirectories] = useState<
    Set<string>
  >(() => new Set());

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

  function openDiffFile(path: string) {
    setOpenedDiffFilePaths((current) =>
      current.includes(path) ? current : [...current, path],
    );
    setSelectedDiffFilePath(path);
    setSelectedDisplayTabId("diff-detail");
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
    selectedDisplayTabId,
    setSelectedDisplayTabId,
    openedDiffFilePaths,
    selectedDiffFilePath,
    setSelectedDiffFilePath,
    collapsedDiffDirectories,
    toggleDiffDirectory,
    openDiffFile,
    closeDiffFile,
  };
}
