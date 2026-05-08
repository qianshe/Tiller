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

export function buildMissionDiffTree(
  files: FileDiffSummary[],
): MissionDiffTreeNode[] {
  const root: MissionDiffTreeNode = {
    id: "root",
    name: "",
    path: "",
    kind: "directory",
    count: 0,
    children: [],
  };
  for (const file of files) {
    const normalized = normalizeDiffPath(file.path);
    const parts = normalized.split("/").filter(Boolean);
    let current = root;
    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;
      const nodePath = parts.slice(0, index + 1).join("/");
      current.children ??= [];
      let node = current.children.find(
        (child) =>
          child.path === nodePath &&
          child.kind === (isFile ? "file" : "directory"),
      );
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
  return (root.children ?? []).map(compactMissionDiffTreeNode);
}

function updateMissionDiffTreeCounts(node: MissionDiffTreeNode): number {
  if (node.kind === "file") {
    node.count = 1;
    return 1;
  }

  node.count =
    node.children?.reduce(
      (total, child) => total + updateMissionDiffTreeCounts(child),
      0,
    ) ?? 0;
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

function compactMissionDiffTreeNode(
  node: MissionDiffTreeNode,
): MissionDiffTreeNode {
  if (node.kind === "file") return node;

  let compacted: MissionDiffTreeNode = {
    ...node,
    children: node.children?.map(compactMissionDiffTreeNode),
  };

  while (
    compacted.children?.length === 1 &&
    compacted.children[0]?.kind === "directory"
  ) {
    const child = compacted.children[0];
    compacted = {
      ...child,
      id: `${compacted.id}/${child.name}`,
      name: `${compacted.name}/${child.name}`,
      path: child.path,
      count: child.count,
      children: child.children,
    };
  }

  return compacted;
}

export function formatDiffStatus(status: FileDiffSummary["status"]) {
  return status === "modified" ? "M" : status === "added" ? "A" : "D";
}

export function renderDiffStats(file: FileDiffSummary) {
  return (
    <span className="diff-meta diff-meta-split inline-flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums">
      <span className={`diff-additions ${resolveDiffStatClass(file.additions, "additions")}`}>+{file.additions}</span>
      <span className="diff-separator text-muted-foreground/60">/</span>
      <span className={`diff-deletions ${resolveDiffStatClass(file.deletions, "deletions")}`}>-{file.deletions}</span>
    </span>
  );
}

function resolveDiffStatClass(value: number, kind: "additions" | "deletions") {
  if (value === 0) return "text-muted-foreground/60";
  return kind === "additions" ? "text-success" : "text-destructive";
}

export function renderDiffPatch(patch: string) {
  return (
    <pre className="mission-diff-patch overflow-x-auto rounded-b-md border-t border-border-ghost bg-surface font-mono text-xs leading-5 text-foreground">
      {patch.split(/\r?\n/u).map((line, index) => (
        <span
          key={`${index}-${line.slice(0, 12)}`}
          className={`mission-diff-line block min-w-max whitespace-pre px-3 ${resolveDiffLineStyleClass(resolveDiffLineClass(line))}`}
        >
          <span className="mr-3 inline-block w-10 select-none text-right text-muted-foreground/70">
            {index + 1}
          </span>
          {line || " "}
        </span>
      ))}
    </pre>
  );
}

function resolveDiffLineStyleClass(lineClass: string) {
  if (lineClass === "line-added") return "diff-line-added bg-success-container/30 text-foreground";
  if (lineClass === "line-deleted") return "diff-line-deleted bg-destructive/10 text-foreground";
  if (lineClass === "line-hunk") return "diff-line-hunk bg-primary-soft text-primary font-semibold";
  if (lineClass === "line-meta") return "diff-line-meta bg-surface-emphasis text-muted-foreground";
  return "diff-line-context text-foreground";
}

export function resolveDiffLineClass(line: string) {
  if (line.startsWith("@@")) return "line-hunk";
  if (line.startsWith("+") && !line.startsWith("+++")) return "line-added";
  if (line.startsWith("-") && !line.startsWith("---")) return "line-deleted";
  if (
    line.startsWith("diff --git") ||
    line.startsWith("index ") ||
    line.startsWith("---") ||
    line.startsWith("+++")
  )
    return "line-meta";
  return "line-context";
}
