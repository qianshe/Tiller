import type { FileDiffSummary } from "@tiller/shared";
import { useRef } from "react";
import { Icon } from "../../../shared/ui";
import { cn } from "../../../shared/utils/cn";
import { useLongPress } from "../hooks/use-pointer-input";
import {
  diffLineKey,
  parseDiffPatchLines,
  type ParsedDiffLine,
} from "../utils/diff-comment-selection";

export type GitDiffTreeNode = {
  id: string;
  name: string;
  path: string;
  kind: "directory" | "file";
  count: number;
  file?: FileDiffSummary;
  children?: GitDiffTreeNode[];
};

export function buildGitDiffTree(files: FileDiffSummary[]): GitDiffTreeNode[] {
  const root: GitDiffTreeNode = {
    id: "root",
    name: "",
    path: "",
    kind: "directory",
    count: 0,
    children: [],
  };

  for (const file of files) {
    const parts = normalizeGitPath(file.path).split("/").filter(Boolean);
    let current = root;
    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;
      const path = parts.slice(0, index + 1).join("/");
      current.children ??= [];
      let node = current.children.find((item) => item.path === path);
      if (!node) {
        node = {
          id: `${isFile ? "file" : "directory"}:${path}`,
          name: part,
          path,
          kind: isFile ? "file" : "directory",
          count: 0,
          ...(isFile ? { file } : { children: [] }),
        };
        current.children.push(node);
      }
      if (!isFile) {
        current = node;
      } else {
        node.file = file;
      }
    });
  }

  updateCounts(root);
  sortTree(root);
  return (root.children ?? []).map(compactTreeNode);
}

export function formatGitDiffStatus(status: FileDiffSummary["status"]) {
  return status === "modified" ? "M" : status === "added" ? "A" : "D";
}

export function renderGitDiffStats(file: FileDiffSummary) {
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
      <span className={`diff-additions ${file.additions ? "text-success" : "text-muted-foreground/60"}`}>+{file.additions}</span>
      <span className="diff-separator text-muted-foreground/60">/</span>
      <span className={`diff-deletions ${file.deletions ? "text-destructive" : "text-muted-foreground/60"}`}>-{file.deletions}</span>
    </span>
  );
}

export type GitDiffPointerMode = "fine" | "coarse";

export type GitDiffSelectRangeHandler = (
  line: ParsedDiffLine,
  anchor: HTMLElement,
  extendRange: boolean,
) => void;

export function renderGitDiffPatch(input: {
  patch: string;
  selectedLineKeys?: ReadonlySet<string>;
  onSelectRange?: GitDiffSelectRangeHandler;
  pointerMode?: GitDiffPointerMode;
}) {
  const { patch, selectedLineKeys, onSelectRange, pointerMode = "fine" } = input;
  const visibleLines = parseDiffPatchLines(patch);
  const selectable = Boolean(onSelectRange);
  return (
    <pre className="mission-diff-patch block w-full max-w-full min-w-0 overflow-x-auto bg-transparent font-mono text-xs leading-5 text-foreground">
      <code className="mission-diff-content grid w-max min-w-full">
        {visibleLines.map((line) => {
          const lineKey = line.kind === "hunk"
            ? `${diffLineKey(line)}:${line.displayLineNumber}`
            : diffLineKey(line);
          const selected = selectedLineKeys?.has(lineKey) ?? false;
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
                resolveGitDiffLineClass(line),
                selected && "ring-1 ring-inset ring-primary/70",
              )}
              style={{ display: "grid" }}
            >
              {pointerMode === "coarse" && canComment ? (
                <GitDiffCoarseLineTrigger
                  lineNumber={lineNumber}
                  line={line}
                  selected={selected}
                  onSelectRange={onSelectRange!}
                />
              ) : (
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
                      onClick={(event) => onSelectRange!(line, event.currentTarget, event.shiftKey)}
                    >
                      <Icon name="plus" size={10} strokeWidth={2} />
                    </button>
                  ) : null}
                </span>
              )}
              <span className="pl-2">{line.text || " "}</span>
            </span>
          );
        })}
      </code>
    </pre>
  );
}

export function resolveGitDiffLineClass(line: ParsedDiffLine) {
  if (line.kind === "hunk") return "diff-line-hunk bg-[var(--diff-hunk-bg)] text-[var(--diff-hunk-text)] font-semibold";
  if (line.kind === "added") return "diff-line-added border-l-2 border-[var(--diff-added-border)] bg-[var(--diff-added-bg)] text-[var(--diff-added-text)]";
  if (line.kind === "deleted") return "diff-line-deleted border-l-2 border-[var(--diff-deleted-border)] bg-[var(--diff-deleted-bg)] text-[var(--diff-deleted-text)]";
  return "diff-line-context text-foreground";
}

function GitDiffCoarseLineTrigger({
  lineNumber,
  line,
  selected,
  onSelectRange,
}: {
  lineNumber: number;
  line: ParsedDiffLine;
  selected: boolean;
  onSelectRange: GitDiffSelectRangeHandler;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const { pressing, bind } = useLongPress({
    reachOnRelease: true,
    onReach: () => {
      const anchor = ref.current;
      if (anchor) onSelectRange(line, anchor, false);
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

function normalizeGitPath(path: string) {
  return path.replace(/\\/g, "/");
}

function updateCounts(node: GitDiffTreeNode): number {
  if (node.kind === "file") {
    node.count = 1;
    return 1;
  }
  node.count = node.children?.reduce((sum, child) => sum + updateCounts(child), 0) ?? 0;
  return node.count;
}

function sortTree(node: GitDiffTreeNode) {
  node.children?.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
  node.children?.forEach(sortTree);
}

function compactTreeNode(node: GitDiffTreeNode): GitDiffTreeNode {
  if (node.kind === "file") return node;
  let result = { ...node, children: node.children?.map(compactTreeNode) };
  while (result.children?.length === 1 && result.children[0]?.kind === "directory") {
    const child = result.children[0];
    result = {
      ...child,
      id: `${result.id}/${child.name}`,
      name: `${result.name}/${child.name}`,
      path: child.path,
      count: child.count,
      children: child.children,
    };
  }
  return result;
}
