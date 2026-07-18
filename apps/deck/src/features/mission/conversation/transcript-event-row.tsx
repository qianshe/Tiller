import { useEffect, useRef, useState } from "react";
import type {
  SessionTimelineContextCompactionEntry,
  SessionTimelineHistoryGapEntry,
} from "@tiller/shared";
import { AlertTriangle, ChevronDown, FileText, LoaderCircle } from "lucide-react";
import { Button, Icon } from "../../../shared/ui";
import { cn } from "../../../shared/utils/cn";
import { writeClipboardText } from "./plain-message-items";

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
  const [open, setOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyResetTimeoutRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (copyResetTimeoutRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(copyResetTimeoutRef.current);
    }
  }, []);

  if (entry.phase === "started") {
    return (
      <StatusTranscriptRow
        detail="完成后会基于压缩后的上下文继续回复。"
        icon={LoaderCircle}
        title="正在压缩上下文..."
      />
    );
  }

  const summaryText = entry.summaryText?.trim() ||
    "早期对话历史已压缩以节省上下文空间。";
  const canExpandSummary = entry.detailsVisibility !== "hidden" && Boolean(entry.summaryText?.trim());
  const copyLabel = copyState === "copied"
    ? "已复制压缩摘要"
    : copyState === "failed"
      ? "复制压缩摘要失败"
      : "复制压缩摘要";

  function resetCopyStateAfter(delayMs: number) {
    if (typeof window === "undefined") {
      return;
    }
    if (copyResetTimeoutRef.current !== null) {
      window.clearTimeout(copyResetTimeoutRef.current);
    }
    copyResetTimeoutRef.current = window.setTimeout(() => {
      setCopyState("idle");
      copyResetTimeoutRef.current = null;
    }, delayMs);
  }

  async function copySummary() {
    try {
      await writeClipboardText(
        summaryText,
        typeof navigator === "undefined" ? undefined : navigator.clipboard,
      );
      setCopyState("copied");
      resetCopyStateAfter(1400);
    } catch {
      setCopyState("failed");
      resetCopyStateAfter(1800);
    }
  }

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
          <div className="relative mt-1 pb-6 text-[12.5px] leading-[1.6] text-muted-foreground">
            <div className="whitespace-pre-wrap">{summaryText}</div>
            <div className="compaction-summary-actions absolute bottom-0 right-0 flex items-center gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="compaction-summary-collapse text-muted-foreground opacity-70 hover:opacity-100"
                aria-label="收起摘要"
                title="收起摘要"
                onClick={() => setOpen(false)}
              >
                <Icon name="chevronDown" size={12} className="rotate-180" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="compaction-summary-copy text-muted-foreground opacity-70 hover:opacity-100"
                aria-label={copyLabel}
                title={copyLabel}
                onClick={() => void copySummary()}
              >
                <Icon name={copyState === "copied" ? "check" : "copy"} size={12} />
              </Button>
            </div>
            <span className="sr-only" aria-live="polite">
              {copyState === "copied"
                ? "已复制压缩摘要"
                : copyState === "failed"
                  ? "复制压缩摘要失败"
                  : ""}
            </span>
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
