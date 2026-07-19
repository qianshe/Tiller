import { useEffect, useRef, useState, type JSX, type ReactElement } from "react";
import type { CanonicalSessionUsage } from "@tiller/shared";
import { useDeckStore } from "../../../store";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../../shared/ui";

const DASH = "–";
const RADIUS = 6;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS; // ≈37.699

/**
 * 降幅 ≥ 此阈值视为 compaction,允许水位下降;否则视为 agent 交替上报
 * 不同口径(如完整窗口 vs 活动段,实测约 2x 差)的噪音,丢弃以稳定显示。
 * 取值依据:Claude Code 实测口径噪音降幅 ~50%,真 compact 通常 ≥75%。
 */
export const COMPACT_DROP_THRESHOLD = 0.6;
/**
 * 节流窗口:升水位期间多次上报在窗口内只刷新一次 UI,降低重渲染频次。
 * compaction 触发的下降不受节流,立即刷新。
 */
export const USAGE_THROTTLE_MS = 500;

/**
 * high-water + compaction 判定。返回 true 表示 next 应作为新显示值。
 * 纯函数便于单测;时间相关节流由组件 effect 处理。
 */
export function shouldAcceptUsageUpdate(
  prev: number | undefined,
  next: number,
): boolean {
  if (prev === undefined) return true;
  if (next >= prev) return true;
  const drop = (prev - next) / prev;
  return drop >= COMPACT_DROP_THRESHOLD;
}

/**
 * 悬浮窗内容(纯展示,SSR 可单独渲染断言)。从组件抽出以便测试在
 * 不依赖 Radix Portal(runtime 才 mount)的前提下断言文案与降级。
 */
export function buildUsageTooltipBody(usage: CanonicalSessionUsage): ReactElement {
  const ratio = usage.size > 0 ? usage.used / usage.size : 0;
  const remainderPct = Math.round((1 - ratio) * 100);
  const formattedUsed = usage.used.toLocaleString("en-US");
  const formattedSize = usage.size.toLocaleString("en-US");
  const hasCost = Boolean(usage.cost && typeof usage.cost.amount === "number");
  return (
    <div className="grid gap-0.5 text-xs leading-tight tabular-nums">
      <div className="flex justify-between gap-3">
        <span className="font-medium text-muted-foreground">剩余:</span>
        <span className="text-foreground">{remainderPct}%</span>
      </div>
      <div className="flex justify-between gap-3">
        <span className="font-medium text-muted-foreground">用量:</span>
        <span className="text-foreground">{formattedUsed} / {formattedSize} t</span>
      </div>
      {hasCost ? (
        <div className="flex justify-between gap-3">
          <span className="font-medium text-muted-foreground">费用:</span>
          <span className="text-foreground">${usage.cost!.amount.toFixed(2)}</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 稳定化 usage:high-water(只升不降,降幅≥60% 视为 compact 才降)
 * + 500ms 节流(升水位合并刷新,compact 立即刷新)。
 * SSR 下 effect 不跑,直接返回 lazy initial(真实快照),兼容
 * renderToStaticMarkup 测试与 zustand v5 server snapshot 行为。
 */
function useStableUsage(
  sessionId: string | null | undefined,
): CanonicalSessionUsage | undefined {
  const live = useDeckStore((state) =>
    sessionId ? state.sessionLiveStates[sessionId]?.usage : undefined,
  );
  const [stable, setStable] = useState<CanonicalSessionUsage | undefined>(() =>
    sessionId ? useDeckStore.getState().sessionLiveStates[sessionId]?.usage : undefined,
  );
  const highWaterRef = useRef<number | undefined>(stable?.used);
  const lastFlushRef = useRef<number>(0);

  // 会话切换:重置水位与显示,避免跨会话串值。
  useEffect(() => {
    const initial = sessionId
      ? useDeckStore.getState().sessionLiveStates[sessionId]?.usage
      : undefined;
    highWaterRef.current = initial?.used;
    lastFlushRef.current = 0;
    setStable(initial);
  }, [sessionId]);

  // live 上报:high-water 过滤 + 节流刷新。
  useEffect(() => {
    if (!live || live.size <= 0) return;
    if (!shouldAcceptUsageUpdate(highWaterRef.current, live.used)) return;
    const prev = highWaterRef.current;
    const isCompaction = prev !== undefined && live.used < prev;
    highWaterRef.current = live.used;
    const now = Date.now();
    if (isCompaction || now - lastFlushRef.current >= USAGE_THROTTLE_MS) {
      lastFlushRef.current = now;
      setStable(live);
    }
  }, [live]);

  return stable;
}

export type ContextUsageIndicatorProps = {
  sessionId: string | null | undefined;
  isMobile: boolean;
};

export function ContextUsageIndicator({ sessionId, isMobile }: ContextUsageIndicatorProps): JSX.Element {
  const usage = useStableUsage(sessionId);
  const [open, setOpen] = useState(false);

  const ratio = usage && usage.size > 0 ? usage.used / usage.size : 0;
  const hasUsage = ratio > 0;
  const usedPct = Math.round(ratio * 100);
  const offset = CIRCUMFERENCE * (1 - ratio);

  const ringSpan = (
    <span
      className="relative inline-flex h-5 w-5 items-center justify-center"
      role={hasUsage ? "button" : undefined}
      tabIndex={hasUsage ? 0 : undefined}
      aria-label={hasUsage ? `上下文已用 ${usedPct}%` : undefined}
    >
      <svg viewBox="0 0 16 16" className="h-[14px] w-[14px] -rotate-90">
        <circle cx="8" cy="8" r={RADIUS} fill="none" stroke="var(--color-border-ghost)" strokeWidth={2} />
        {hasUsage ? (
          <circle
            cx="8" cy="8" r={RADIUS} fill="none"
            stroke="currentColor" strokeWidth={2} strokeLinecap="round"
            className="text-primary"
            strokeDasharray={CIRCUMFERENCE.toFixed(3)}
            strokeDashoffset={offset.toFixed(3)}
          />
        ) : null}
      </svg>
      {!hasUsage ? <span className="text-2xs text-muted-foreground">{DASH}</span> : null}
    </span>
  );

  if (!hasUsage || !usage) {
    return ringSpan;
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip open={open} onOpenChange={setOpen} disableHoverableContent>
        <TooltipTrigger asChild>
          <span
            className={isMobile ? "cursor-pointer" : "cursor-help"}
            onClick={() => isMobile && setOpen((v) => !v)}
          >
            {ringSpan}
          </span>
        </TooltipTrigger>
        <TooltipContent className="min-w-0 px-2.5 py-1">
          {buildUsageTooltipBody(usage)}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
