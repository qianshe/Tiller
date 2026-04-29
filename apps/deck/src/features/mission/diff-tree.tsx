import type { FileDiffSummary } from "@tiller/shared";

export type MissionDiffTreeNode = {
  id: string;
  name: string;
  path: string;
  kind: "directory" | "file";
  count: number;
  file?: FileDiffSummary;
  children?: MissionDiffTreeNode[];
};

export function resolveMissionPanelIcon(pageId: string) {
  if (pageId === "overview") return "⌂";
  if (pageId === "changes") return "◇";
  if (pageId === "diff-detail") return "≋";
  if (pageId === "logbook") return "▸";
  return "□";
}

export function buildMissionDiffTree(files: FileDiffSummary[]): MissionDiffTreeNode[] {
  const root: MissionDiffTreeNode = { id: "root", name: "", path: "", kind: "directory", count: 0, children: [] };
  for (const file of files) {
    const normalized = normalizeDiffPath(file.path);
    const parts = normalized.split("/").filter(Boolean);
    let current = root;
    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;
      const nodePath = parts.slice(0, index + 1).join("/");
      current.children ??= [];
      let node = current.children.find((child) => child.path === nodePath && child.kind === (isFile ? "file" : "directory"));
      if (!node) {
        node = {
          id: `${isFile ? "file" : "dir"}:${nodePath}`,
          name: part,
          path: nodePath,
          kind: isFile ? "file" : "directory",
          count: 0,
          ...(isFile ? { file } : { children: [] }),
        };
        current.children.push(node);
      }
      if (isFile) {
        node.file = file;
      } else {
        current = node;
      }
    });
  }

  updateMissionDiffTreeCounts(root);
  sortMissionDiffTree(root);
  return root.children ?? [];
}

function updateMissionDiffTreeCounts(node: MissionDiffTreeNode): number {
  if (node.kind === "file") {
    node.count = 1;
    return 1;
  }

  node.count = node.children?.reduce((total, child) => total + updateMissionDiffTreeCounts(child), 0) ?? 0;
  return node.count;
}

function sortMissionDiffTree(node: MissionDiffTreeNode) {
  node.children?.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
  node.children?.forEach(sortMissionDiffTree);
}

function normalizeDiffPath(path: string) {
  return path.replace(/\\/g, "/");
}

export function formatDiffStatus(status: FileDiffSummary["status"]) {
  return status === "modified" ? "M" : status === "added" ? "A" : "D";
}

export function renderDiffStats(file: FileDiffSummary) {
  return (
    <span className="diff-meta diff-meta-split">
      <span className="diff-additions">+{file.additions}</span>
      <span className="diff-separator">/</span>
      <span className="diff-deletions">-{file.deletions}</span>
    </span>
  );
}

export function renderDiffPatch(patch: string) {
  return (
    <pre className="mission-diff-patch">
      {patch.split(/\r?\n/u).map((line, index) => (
        <span key={`${index}-${line.slice(0, 12)}`} className={`mission-diff-line ${resolveDiffLineClass(line)}`}>
          {line || " "}
        </span>
      ))}
    </pre>
  );
}

export function resolveDiffLineClass(line: string) {
  if (line.startsWith("@@")) return "line-hunk";
  if (line.startsWith("+") && !line.startsWith("+++")) return "line-added";
  if (line.startsWith("-") && !line.startsWith("---")) return "line-deleted";
  if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) return "line-meta";
  return "line-context";
}

