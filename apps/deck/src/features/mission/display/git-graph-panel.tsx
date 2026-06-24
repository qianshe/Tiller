import type { CSSProperties } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../../shared/ui";
import { MarkdownMessage } from "../../../shared/ui/markdown";
import { cn } from "../../../shared/utils/cn";
import type { GitCommit, GitGraphState } from "../../../store/slices/projects-slice";

type GitGraphPanelProps = {
  style?: CSSProperties;
  gitGraph?: GitGraphState;
  selectedCommitHash?: string | null;
  onSelectCommit?: (hash: string) => void;
};

type GraphRowModel = {
  commit: GitCommit;
  lane: number;
  activeLanes: number[];
  continuingLanes: number[];
  joinLanes: number[];
  mergeLanes: number[];
  laneCount: number;
};

const GRAPH_LANE_WIDTH = 14;
const GRAPH_ROW_HEIGHT = 32;
const GRAPH_LINE_OVERDRAW = 3;
const GRAPH_LANE_COLORS = [
  "#3b82f6",
  "#f97316",
  "#22c55e",
  "#a855f7",
  "#eab308",
];

export function GitGraphPanel({
  style,
  gitGraph,
  selectedCommitHash,
  onSelectCommit,
}: GitGraphPanelProps) {
  if (!gitGraph || !gitGraph.commits?.length) {
    return (
      <div
        className="git-graph-panel flex min-h-0 flex-1 flex-col overflow-auto p-4 text-sm text-muted-foreground"
        style={style}
      >
        <div className="empty-state">暂无提交记录</div>
      </div>
    );
  }

  const rows = buildGraphRows(gitGraph.commits);
  const visibleLaneCount = Math.max(1, ...rows.map(resolveVisibleLaneCount));
  const graphColumnWidth = Math.max(40, visibleLaneCount * GRAPH_LANE_WIDTH + 8);
  const rowColumnStyle = {
    gridTemplateColumns: `${graphColumnWidth}px minmax(0,1fr)`,
  } satisfies CSSProperties;

  return (
    <div
      className="git-graph-panel flex min-h-0 flex-1 flex-col overflow-auto"
      style={style}
    >
      <div
        className="grid items-center gap-2 border-b border-border-ghost px-3 py-2 text-2xs uppercase tracking-[0.08em] text-muted-foreground"
        style={rowColumnStyle}
      >
        <span>Graph</span>
        <span>提交历史</span>
      </div>
      <TooltipProvider delayDuration={180}>
        <div className="git-graph-list">
          {rows.map((row, index) => {
            const isSelected = selectedCommitHash === row.commit.hash;
            return (
              <Tooltip key={row.commit.hash}>
                <TooltipTrigger asChild>
                  <button
                  type="button"
                  data-merge-commit={row.commit.parents.length > 1 ? "true" : undefined}
                  className={cn(
                    "grid h-9 w-full items-center gap-2 px-3 text-left text-xs transition-colors hover:bg-surface-emphasis",
                    isSelected && "bg-surface-emphasis",
                  )}
                    style={rowColumnStyle}
                    onClick={() => onSelectCommit?.(row.commit.hash)}
                  >
                    <GraphLaneCell
                      row={row}
                      laneCount={visibleLaneCount}
                      isFirst={index === 0}
                      isLast={index === rows.length - 1}
                    />
                    <span className="flex h-full min-w-0 items-center gap-2 overflow-hidden border-b border-border-ghost">
                      {row.commit.refs.length > 0 ? (
                        <span className="flex shrink-0 flex-wrap gap-1">
                          {row.commit.refs.map((ref, idx) => (
                            <RefPill key={`${ref.name}-${idx}`} ref={ref} />
                          ))}
                        </span>
                      ) : null}
                      <span className="min-w-0 truncate">{row.commit.subject}</span>
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  align="start"
                  className="max-w-[460px] space-y-2 px-3 py-2 text-left"
                >
                  <div className="font-medium text-foreground">{row.commit.subject}</div>
                  {row.commit.refs.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {row.commit.refs.map((ref, idx) => (
                        <RefPill key={`tooltip-${ref.name}-${idx}`} ref={ref} />
                      ))}
                    </div>
                  ) : null}
                  {buildCommitTooltipMarkdown(row.commit) ? (
                    <MarkdownMessage text={buildCommitTooltipMarkdown(row.commit)!} />
                  ) : null}
                  {typeof row.commit.changedFiles === "number" ? (
                    <div className="text-2xs text-muted-foreground">
                      已更改 {row.commit.changedFiles} 个文件
                      {typeof row.commit.insertions === "number"
                        ? `, ${row.commit.insertions} 行插入(+)`
                        : ""}
                      {typeof row.commit.deletions === "number"
                        ? `, ${row.commit.deletions} 行删除(-)`
                        : ""}
                    </div>
                  ) : null}
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-2xs text-muted-foreground">
                    <span>作者</span>
                    <span>{row.commit.authorName}</span>
                    <span>时间</span>
                    <span>{new Date(row.commit.authoredAt).toLocaleString("zh-CN")}</span>
                    <span>提交</span>
                    <span className="font-mono">{row.commit.hash}</span>
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>
    </div>
  );
}

function GraphLaneCell({
  row,
  laneCount,
  isFirst,
  isLast,
}: {
  row: GraphRowModel;
  laneCount: number;
  isFirst: boolean;
  isLast: boolean;
}) {
  const width = Math.max(laneCount, 1) * GRAPH_LANE_WIDTH;
  const centerY = GRAPH_ROW_HEIGHT / 2;
  const laneColor = resolveGraphLaneColor(row.lane);

  return (
    <span className="flex items-center" aria-hidden="true">
      <svg
        data-graph-svg="true"
        width={width}
        height={GRAPH_ROW_HEIGHT}
        viewBox={`0 0 ${width} ${GRAPH_ROW_HEIGHT}`}
        className="overflow-visible"
      >
        {row.activeLanes.map((laneIndex) => {
          if (row.joinLanes.includes(laneIndex)) {
            return null;
          }
          const x = laneCenterX(laneIndex);
          const strokeColor = resolveGraphLaneColor(laneIndex);
          const lineTop = isFirst ? centerY : -GRAPH_LINE_OVERDRAW;
          const lineBottom = row.continuingLanes.includes(laneIndex) && !isLast
            ? GRAPH_ROW_HEIGHT + GRAPH_LINE_OVERDRAW
            : centerY;
          return (
            <line
              key={`lane-${row.commit.hash}-${laneIndex}`}
              x1={x}
              y1={lineTop}
              x2={x}
              y2={lineBottom}
              stroke={strokeColor}
              strokeOpacity="0.85"
              strokeWidth={1.6}
            />
          );
        })}
        {row.joinLanes.map((laneIndex) => (
          <path
            key={`join-${row.commit.hash}-${laneIndex}`}
            d={describeJoinPath(laneCenterX(laneIndex), laneCenterX(row.lane), centerY)}
            fill="none"
            stroke={resolveGraphLaneColor(laneIndex)}
            strokeOpacity="0.85"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {row.mergeLanes.map((laneIndex) => (
          <path
            key={`merge-${row.commit.hash}-${laneIndex}`}
            d={describeMergePath(laneCenterX(row.lane), laneCenterX(laneIndex), centerY)}
            fill="none"
            stroke={resolveGraphLaneColor(laneIndex)}
            strokeOpacity="0.85"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            data-merge-edge="true"
          />
        ))}
        <circle
          cx={laneCenterX(row.lane)}
          cy={centerY}
          r={4.5}
          fill={laneColor}
          stroke={laneColor}
          strokeWidth={1}
        />
      </svg>
    </span>
  );
}

function buildGraphRows(commits: GitCommit[]): GraphRowModel[] {
  const rows: GraphRowModel[] = [];
  const visibleCommitHashes = new Set(commits.map((commit) => commit.hash));
  let lanes: Array<string | null> = [];

  for (const commit of commits) {
    const matchingLanes = lanes.flatMap((value, index) =>
      value === commit.hash ? [index] : [],
    );
    let lane = matchingLanes[0] ?? -1;
    if (lane === -1) {
      lane = lanes.findIndex((value) => value === null);
      if (lane === -1) {
        lane = lanes.length;
      }
      lanes[lane] = commit.hash;
    }

    const activeLanes = lanes.flatMap((value, index) =>
      value && visibleCommitHashes.has(value) ? [index] : [],
    );
    const joinLanes = matchingLanes.filter((laneIndex) => laneIndex !== lane);
    const nextLanes = [...lanes];
    const [firstParent, ...otherParents] = commit.parents;
    nextLanes[lane] =
      firstParent && visibleCommitHashes.has(firstParent) ? firstParent : null;
    for (const joinLane of joinLanes) {
      nextLanes[joinLane] = null;
    }

    const mergeLanes: number[] = [];
    for (const parentHash of otherParents) {
      if (!visibleCommitHashes.has(parentHash)) {
        continue;
      }
      let parentLane = nextLanes.indexOf(parentHash);
      if (parentLane === -1) {
        parentLane = nextLanes.findIndex(
          (value, index) => index > lane && value === null,
        );
        if (parentLane === -1) {
          parentLane = nextLanes.length;
        }
        nextLanes[parentLane] = parentHash;
      }
      mergeLanes.push(parentLane);
    }

    for (let index = 0; index < nextLanes.length; index += 1) {
      const laneValue = nextLanes[index];
      if (laneValue && !visibleCommitHashes.has(laneValue)) {
        nextLanes[index] = null;
      }
    }

    while (nextLanes.length > 0 && nextLanes.at(-1) === null) {
      nextLanes.pop();
    }
    const continuingLanes = nextLanes.flatMap((value, index) =>
      value && visibleCommitHashes.has(value) ? [index] : [],
    );

    rows.push({
      commit,
      lane,
      activeLanes,
      continuingLanes,
      joinLanes,
      mergeLanes,
      laneCount: Math.max(lanes.length, nextLanes.length, lane + 1),
    });

    lanes = nextLanes;
  }

  return rows;
}

function RefPill({
  ref,
}: {
  ref: { name: string; kind: string; isCurrent: boolean };
}) {
  const kindStyle = {
    branch:
      "bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100",
    tag: "bg-purple-100 text-purple-900 dark:bg-purple-900 dark:text-purple-100",
    detached:
      "bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-100",
  }[ref.kind] || "bg-gray-100 text-gray-900 dark:bg-gray-900 dark:text-gray-100";

  const prefix = ref.isCurrent ? "HEAD -> " : "";

  return (
    <span
      className={cn(
        "inline-block rounded px-2 py-0.5 text-2xs font-medium",
        kindStyle,
      )}
    >
      {prefix}
      {ref.name}
    </span>
  );
}

function formatRelativeTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (seconds < 60) {
      return "刚刚";
    }
    if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      return `${minutes} 分钟前`;
    }
    if (seconds < 86400) {
      const hours = Math.floor(seconds / 3600);
      return `${hours} 小时前`;
    }
    if (seconds < 604800) {
      const days = Math.floor(seconds / 86400);
      return `${days} 天前`;
    }

    return date.toLocaleDateString("zh-CN");
  } catch {
    return isoString;
  }
}

function buildCommitTooltipMarkdown(commit: GitCommit) {
  if (!commit.body?.trim()) {
    return "";
  }
  const lines = commit.body
    .split(/\r?\n/u)
    .map((line) => line.replace(/\uFFFD/gu, "").trim())
    .filter((line) => /[\p{L}\p{N}\p{Script=Han}]/u.test(line))
    .slice(0, 6);
  if (!lines.length) {
    return "";
  }
  return lines
    .map((line) => (line.startsWith("-") || line.startsWith("*") ? line : `- ${line}`))
    .join("\n");
}

function laneCenterX(laneIndex: number) {
  return laneIndex * GRAPH_LANE_WIDTH + GRAPH_LANE_WIDTH / 2;
}

function resolveGraphLaneColor(laneIndex: number) {
  return GRAPH_LANE_COLORS[laneIndex % GRAPH_LANE_COLORS.length]!;
}

function resolveVisibleLaneCount(row: GraphRowModel) {
  return (
    Math.max(
      row.lane,
      ...row.activeLanes,
      ...row.joinLanes,
      ...row.mergeLanes,
      0,
    ) + 1
  );
}

function describeJoinPath(fromX: number, toX: number, centerY: number) {
  const bendY = centerY - 8;
  const controlX = fromX < toX ? fromX + 8 : fromX - 8;
  return `M ${fromX} ${-GRAPH_LINE_OVERDRAW} L ${fromX} ${bendY} C ${fromX} ${centerY - 2}, ${controlX} ${centerY}, ${toX} ${centerY}`;
}

function describeMergePath(fromX: number, toX: number, centerY: number) {
  const bendY = centerY + 8;
  const controlX = fromX < toX ? toX - 8 : toX + 8;
  return `M ${fromX} ${centerY} C ${fromX} ${centerY + 2}, ${controlX} ${centerY}, ${toX} ${bendY} L ${toX} ${GRAPH_ROW_HEIGHT + GRAPH_LINE_OVERDRAW}`;
}
