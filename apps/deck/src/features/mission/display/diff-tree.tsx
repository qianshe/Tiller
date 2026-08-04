import { useRef } from "react";
import type { FileDiffSummary } from "@tiller/shared";
import {
  diffLineKey,
  parseDiffPatchLines,
  type ParsedDiffLine,
} from "./diff-comment-selection";
import { cn } from "../../../shared/utils/cn";
import { Icon } from "../../../shared/ui";
import { useLongPress } from "../hooks/use-pointer-input";

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
  if (pageId === "graph") return "◆";
  if (pageId === "diff-detail") return "≋";
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
  if (file.additions === 0 && file.deletions === 0) {
    return (
      <span
        className="diff-meta diff-meta-split inline-flex shrink-0 items-center font-mono text-xs tabular-nums text-muted-foreground/60"
        title="无行级变更"
      >
        —
      </span>
    );
  }
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

export type DiffPointerMode = "fine" | "coarse";

export type DiffSelectRangeHandler = (
  line: ParsedDiffLine,
  anchor: HTMLElement,
  extendRange: boolean,
) => void;

export function renderDiffPatch(input: {
  patch: string;
  selectedLineKeys?: ReadonlySet<string>;
  onSelectRange?: DiffSelectRangeHandler;
  pointerMode?: DiffPointerMode;
}) {
  const { patch, selectedLineKeys, onSelectRange, pointerMode = "fine" } = input;
  const visibleLines = parseDiffPatchLines(patch);
  const selectable = Boolean(onSelectRange);

  return (
    <pre className="mission-diff-patch block w-full max-w-full min-w-0 overflow-x-auto bg-transparent font-mono text-xs leading-5 text-foreground">
      <code className="mission-diff-content grid w-max min-w-full">
        {visibleLines.map((line) => {
          // 语义键对 hunk 头恒为 "hunk:_:_"(无新旧行号),多个 hunk 会产生重复
          // React key;hunk 不可选区,可安全叠加 display 行号保证唯一。
          const lineKey = line.kind === "hunk"
            ? `${diffLineKey(line)}:${line.displayLineNumber}`
            : diffLineKey(line);
          const selected = selectedLineKeys?.has(lineKey) ?? false;
          const lineClassName = resolveDiffLineStyleClass(resolveDiffLineClass(line.text));
          const lineNumber = line.newLineNumber ?? line.oldLineNumber ?? line.displayLineNumber;
          const canComment = selectable && line.kind !== "hunk";
          return (
            <span
              key={lineKey}
              data-diff-line-key={lineKey}
              className={cn(
                "mission-diff-line group grid w-full min-w-full whitespace-pre px-0.5 text-left",
                pointerMode === "coarse"
                  ? "grid-cols-[3rem_max-content]"
                  : "grid-cols-[2.5rem_max-content]",
                lineClassName,
                selected && "ring-1 ring-inset ring-primary/70",
              )}
              style={{ display: "grid" }}
            >
              {pointerMode === "coarse" && canComment ? (
                <CoarseDiffLineTrigger
                  lineNumber={lineNumber}
                  line={line}
                  selected={selected}
                  onSelectRange={onSelectRange!}
                />
              ) : (
                <>
                  <span className="relative flex min-w-0 items-center justify-end pl-1 pr-1 text-right text-muted-foreground/70">
                    <span
                      className={cn(
                        "select-none transition-opacity",
                        canComment && "group-hover:opacity-0 group-focus-within:opacity-0",
                        selected && "opacity-0",
                      )}
                    >
                      {lineNumber}
                    </span>
                    {canComment ? (
                      <button
                        type="button"
                        className={cn(
                          "mission-diff-comment-trigger absolute right-1 top-1/2 grid size-4 -translate-y-1/2 place-items-center rounded border border-border-ghost bg-surface-elevated text-muted-foreground opacity-0 shadow-sm transition-[opacity,color,background-color] hover:bg-surface-emphasis hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 group-hover:opacity-100",
                          selected && "bg-primary text-primary-foreground opacity-100 hover:bg-primary-strong hover:text-primary-foreground",
                        )}
                        aria-label={`添加第 ${lineNumber} 行评论`}
                        aria-pressed={selected}
                        title="添加评论"
                        onClick={(event) =>
                          onSelectRange!(line, event.currentTarget, event.shiftKey)
                        }
                      >
                        <Icon name="plus" size={10} strokeWidth={2} />
                      </button>
                    ) : null}
                  </span>
                </>
              )}
              <span className="pl-2">{line.text || " "}</span>
            </span>
          );
        })}
      </code>
    </pre>
  );
}

/**
 * 触控设备(coarse pointer)的行号区触发器:轻点行号区触发评论。
 * 行号区已 select-none,移动超过容差不会误触;代码正文不受影响,可正常选择/复制。
 */
function CoarseDiffLineTrigger({
  lineNumber,
  line,
  selected,
  onSelectRange,
}: {
  lineNumber: number;
  line: ParsedDiffLine;
  selected: boolean;
  onSelectRange: DiffSelectRangeHandler;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const { pressing, bind } = useLongPress({
    reachOnRelease: true,
    onReach: () => {
      const anchor = ref.current;
      if (anchor) {
        onSelectRange(line, anchor, false);
      }
    },
  });
  return (
    <span
      ref={ref}
      data-diff-coarse-trigger="true"
      className={cn(
        "relative flex min-w-0 touch-pan-y select-none items-center justify-end pl-1 pr-1 text-right text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        (selected || pressing) && "bg-primary-soft/40 ring-1 ring-inset ring-primary/50",
      )}
      aria-label={`轻点第 ${lineNumber} 行添加评论`}
      aria-pressed={selected}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && ref.current) {
          event.preventDefault();
          onSelectRange(line, ref.current, event.shiftKey);
        }
      }}
      {...bind}
    >
      <span className="min-w-0 truncate tabular-nums">{lineNumber}</span>
    </span>
  );
}

function isDiffHeaderLine(line: string) {
  return (
    line.startsWith("diff --git") ||
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ")
  );
}

function resolveDiffLineStyleClass(lineClass: string) {
  if (lineClass === "line-added")
    return "diff-line-added border-l-2 border-[var(--diff-added-border)] bg-[var(--diff-added-bg)] text-[var(--diff-added-text)]";
  if (lineClass === "line-deleted")
    return "diff-line-deleted border-l-2 border-[var(--diff-deleted-border)] bg-[var(--diff-deleted-bg)] text-[var(--diff-deleted-text)]";
  if (lineClass === "line-hunk")
    return "diff-line-hunk bg-[var(--diff-hunk-bg)] text-[var(--diff-hunk-text)] font-semibold";
  if (lineClass === "line-meta")
    return "diff-line-meta bg-[var(--diff-meta-bg)] text-[var(--diff-meta-text)]";
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
