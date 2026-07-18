import { useState, type JSX } from "react";
import { useDeckStore } from "../../../store";

const DASH = "–";
const RADIUS = 6;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS; // ≈37.699

export type ContextUsageIndicatorProps = {
  sessionId: string | null | undefined;
  isMobile: boolean;
};

export function ContextUsageIndicator({ sessionId }: ContextUsageIndicatorProps): JSX.Element {
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

  const ratio = usage && usage.size > 0 ? usage.used / usage.size : 0;
  const hasUsage = ratio > 0;
  const usedPct = Math.round(ratio * 100);
  const offset = CIRCUMFERENCE * (1 - ratio);

  return (
    <span
      className="relative inline-flex h-5 w-5 items-center justify-center"
      role={hasUsage ? "button" : undefined}
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
}
