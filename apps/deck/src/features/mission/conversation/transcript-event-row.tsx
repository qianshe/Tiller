import { useState } from "react";
import type {
  SessionTimelineContextCompactionEntry,
  SessionTimelineHistoryGapEntry,
  SessionTimelineResumedEntry,
} from "@tiller/shared";
import { AlertTriangle, ChevronDown, FileText, PlayCircle } from "lucide-react";
import { cn } from "../../../shared/utils/cn";

const TRANSCRIPT_ROW_CLASS =
  "plain-transcript-row mr-auto grid w-full max-w-full grid-cols-[0.375rem_minmax(0,1fr)] items-start gap-x-1 text-muted-foreground";
const TRANSCRIPT_SURFACE_CLASS =
  "min-w-0 rounded-[8px] border border-border-ghost bg-surface-sunken/55 px-2 py-1 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]";

export function TranscriptEventRow(props: {
  entry:
    | SessionTimelineContextCompactionEntry
    | SessionTimelineResumedEntry
    | SessionTimelineHistoryGapEntry;
}) {
  if (props.entry.kind === "context_compaction") {
    return <ContextCompactionRow entry={props.entry} />;
  }

  if (props.entry.kind === "session_resumed") {
    return (
      <StatusTranscriptRow
        detail={`恢复方式 ${props.entry.restoreMethod}`}
        icon={PlayCircle}
        title="会话已恢复"
      />
    );
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
  const [open, setOpen] = useState(false);
  const summaryText = entry.summaryText?.trim() ||
    "早期对话历史已压缩以节省上下文空间。";

  return (
    <div className={TRANSCRIPT_ROW_CLASS}>
      <span aria-hidden="true" />
      <section className={TRANSCRIPT_SURFACE_CLASS}>
        <div className="flex items-start gap-2">
          <FileText className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-xs font-medium text-foreground">
                上下文已压缩
              </span>
              <span className="min-w-0 truncate text-[11px] text-muted-foreground/70">
                早期对话已收敛为系统摘要
              </span>
            </div>
            {open ? (
              <div className="mt-1 whitespace-pre-wrap text-[12.5px] leading-[1.6] text-muted-foreground">
                {summaryText}
              </div>
            ) : (
              <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                {summarizeTranscriptPreview(summaryText)}
              </p>
            )}
          </div>
          <button
            type="button"
            className="flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
            aria-label={open ? "收起摘要" : "展开摘要"}
            onClick={() => setOpen((current) => !current)}
          >
            <span>{open ? "收起摘要" : "展开摘要"}</span>
            <ChevronDown
              className={cn(
                "size-3 transition-transform duration-150",
                open && "rotate-180",
              )}
            />
          </button>
        </div>
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

function summarizeTranscriptPreview(text: string) {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (normalized.length <= 160) {
    return normalized;
  }
  return `${normalized.slice(0, 157).trimEnd()}...`;
}
