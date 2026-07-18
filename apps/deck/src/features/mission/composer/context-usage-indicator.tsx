import { useState, type JSX, type ReactElement } from "react";
import type { CanonicalSessionUsage } from "@tiller/shared";
import { useDeckStore } from "../../../store";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../../shared/ui";

const DASH = "–";
const RADIUS = 6;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS; // ≈37.699

export type ContextUsageIndicatorProps = {
  sessionId: string | null | undefined;
  isMobile: boolean;
};

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

export function ContextUsageIndicator({ sessionId, isMobile }: ContextUsageIndicatorProps): JSX.Element {
  // SSR 桥接:zustand v5 用 getInitialState 作为 useSyncExternalStore 的 server
  // snapshot,后续 setState 在 server render 时不可见。lazy useState 让首次
  // render 直接读 getState(),使 renderToStaticMarkup 测试与生产客户端首次
  // 渲染都能拿到真实数据;之后 liveUsage selector 接管响应式更新。
  const [initialUsage] = useState(() =>
    sessionId ? useDeckStore.getState().sessionLiveStates[sessionId]?.usage : undefined,
  );
  const liveUsage = useDeckStore((state) =>
    sessionId ? state.sessionLiveStates[sessionId]?.usage : undefined,
  );
  const usage = liveUsage ?? initialUsage;
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
