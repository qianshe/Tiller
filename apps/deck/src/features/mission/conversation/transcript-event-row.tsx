import { useState } from "react";
import type {
  SessionTimelineContextCompactionEntry,
  SessionTimelineHistoryGapEntry,
} from "@tiller/shared";
import { AlertTriangle, ChevronDown, FileText, LoaderCircle } from "lucide-react";
import { cn } from "../../../shared/utils/cn";

const TRANSCRIPT_ROW_CLASS =
  "plain-transcript-row mr-auto grid w-full max-w-full grid-cols-[0.375rem_minmax(0,1fr)] items-start gap-x-1 text-muted-foreground";
const TRANSCRIPT_SURFACE_CLASS =
  "min-w-0 w-full rounded-[8px] border border-border-ghost bg-surface-sunken/55 px-2 py-1 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]";

export function TranscriptEventRow(props: {
  entry:
    | SessionTimelineContextCompactionEntry
    | SessionTimelineHistoryGapEntry;
}) {
  if (props.entry.kind === "context_compaction") {
    return <ContextCompactionRow entry={props.entry} />;
  }

  if (props.entry.kind === "history_gap") {
    return (
      <StatusTranscriptRow
        detail={props.entry.message}
        icon={AlertTriangle}
        title="历史记录缺失"
        tone="danger"
      />
    );
  }

  return null;
}

function ContextCompactionRow({
  entry,
}: {
  entry: SessionTimelineContextCompactionEntry;
}) {
  if (entry.phase === "started") {
    return (
      <StatusTranscriptRow
        detail="完成后会基于压缩后的上下文继续回复。"
        icon={LoaderCircle}
        title="正在压缩上下文..."
      />
    );
  }

  const [open, setOpen] = useState(false);
  const summaryText = entry.summaryText?.trim() ||
    "早期对话历史已压缩以节省上下文空间。";
  const canExpandSummary = entry.detailsVisibility !== "hidden" && Boolean(entry.summaryText?.trim());

  return (
    <div className={TRANSCRIPT_ROW_CLASS}>
      <span aria-hidden="true" />
      <section className={TRANSCRIPT_SURFACE_CLASS}>
        <div className="relative flex min-h-6 items-center justify-center">
          <div className="flex min-w-0 max-w-full items-center gap-2">
            <FileText className="size-3.5 shrink-0 text-primary" />
            <span className="shrink-0 text-xs font-medium text-foreground">
              上下文已压缩
            </span>
          </div>
          {canExpandSummary ? (
            <button
              type="button"
              className="absolute right-0 top-1/2 flex -translate-y-1/2 items-center rounded-sm p-1 text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
              aria-label={open ? "收起摘要" : "展开摘要"}
              onClick={() => setOpen((current) => !current)}
            >
              <ChevronDown
                className={cn(
                  "size-3 transition-transform duration-150",
                  open && "rotate-180",
                )}
              />
            </button>
          ) : null}
        </div>
        {canExpandSummary && open ? (
          <div className="mt-1 whitespace-pre-wrap text-[12.5px] leading-[1.6] text-muted-foreground">
            {summaryText}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function StatusTranscriptRow({
  detail,
  icon: Icon,
  title,
  tone = "default",
}: {
  detail: string;
  icon: typeof AlertTriangle;
  title: string;
  tone?: "default" | "danger";
}) {
  return (
    <div className={TRANSCRIPT_ROW_CLASS}>
      <span aria-hidden="true" />
      <section
        className={cn(
          TRANSCRIPT_SURFACE_CLASS,
          tone === "danger" && "bg-danger-soft/20",
        )}
      >
        <div className="flex min-w-0 items-start gap-2">
          <Icon
            className={cn(
              "mt-0.5 size-3.5 shrink-0",
              tone === "danger" ? "text-danger" : "text-primary",
            )}
          />
          <div className="min-w-0 flex-1">
            <div
              className={cn(
                "text-xs font-medium",
                tone === "danger" ? "text-danger" : "text-foreground",
              )}
            >
              {title}
            </div>
            <p
              className={cn(
                "mt-0.5 text-xs leading-[1.5]",
                tone === "danger" ? "text-danger" : "text-muted-foreground",
              )}
            >
              {detail}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
