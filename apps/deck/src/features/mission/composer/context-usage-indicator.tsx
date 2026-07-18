import type { JSX } from "react";
import { useDeckStore } from "../../../store";

const DASH = "–";

export type ContextUsageIndicatorProps = {
  sessionId: string | null | undefined;
  isMobile: boolean;
};

export function ContextUsageIndicator({ sessionId }: ContextUsageIndicatorProps): JSX.Element {
  const usage = useDeckStore((state) =>
    sessionId ? state.sessionLiveStates[sessionId]?.usage : undefined,
  );
  const hasUsage = Boolean(usage && usage.size > 0);

  return (
    <span className="relative inline-flex h-5 w-5 items-center justify-center">
      <svg viewBox="0 0 16 16" className="h-[14px] w-[14px]">
        <circle cx="8" cy="8" r="6" fill="none" stroke="var(--color-border-ghost)" strokeWidth={2} />
        {hasUsage ? (
          <circle
            cx="8" cy="8" r="6" fill="none"
            stroke="currentColor" strokeWidth={2} strokeLinecap="round"
            className="text-primary"
            strokeDasharray="37.7"
            strokeDashoffset="37.7"
          />
        ) : null}
      </svg>
      {!hasUsage ? <span className="text-2xs text-muted-foreground">{DASH}</span> : null}
    </span>
  );
}