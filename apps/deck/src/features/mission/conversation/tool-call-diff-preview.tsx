import { renderDiffPatch } from "../display/diff-tree";
import type { ToolCallDiff } from "./tool-call-change-stats";

type ToolCallDiffPreviewProps = {
  diff?: ToolCallDiff;
};

export function ToolCallDiffPreview({
  diff,
}: ToolCallDiffPreviewProps) {
  return (
    <div
      className="tool-call-diff-preview mt-1.5 min-w-0 overflow-hidden rounded-lg border border-border-ghost bg-[var(--markdown-code-bg)] shadow-sm"
      data-mission-swipe-lock="true"
    >
      {diff ? (
        <div className="max-h-56 min-w-0 overflow-y-auto [&_.mission-diff-line]:px-2 [&_.mission-diff-patch]:text-[12px]">
          {renderDiffPatch({ patch: diff.patch })}
        </div>
      ) : (
        <div className="tool-call-diff-empty px-3 py-2.5 text-xs text-muted-foreground">
          该调用只提供了变更统计，没有携带可展示的逐行 Diff。
        </div>
      )}
    </div>
  );
}
