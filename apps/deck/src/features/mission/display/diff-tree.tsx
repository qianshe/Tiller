import type { FileDiffSummary } from "@tiller/shared";
import {
  buildGitDiffTree,
  diffLineKey,
  formatGitDiffStatus,
  parseDiffPatchLines,
  renderGitDiffPatch,
  renderGitDiffStats,
  resolveGitDiffLineClass,
  type GitDiffPointerMode,
  type GitDiffSelectRangeHandler,
  type GitDiffTreeNode,
} from "../../git";

export { diffLineKey, parseDiffPatchLines };

export type MissionDiffTreeNode = GitDiffTreeNode;

export function buildMissionDiffTree(files: FileDiffSummary[]): MissionDiffTreeNode[] {
  return buildGitDiffTree(files);
}

export const formatDiffStatus = formatGitDiffStatus;
export const renderDiffStats = renderGitDiffStats;
export const resolveDiffLineClass = resolveGitDiffLineClass;
export type DiffPointerMode = GitDiffPointerMode;
export type DiffSelectRangeHandler = GitDiffSelectRangeHandler;

export function renderDiffPatch(input: {
  patch: string;
  selectedLineKeys?: ReadonlySet<string>;
  onSelectRange?: DiffSelectRangeHandler;
  pointerMode?: DiffPointerMode;
}) {
  return renderGitDiffPatch(input);
}
