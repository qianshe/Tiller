import { useCallback, useState, type ToggleEvent } from "react";
import type { LegacyEvidenceSource } from "@tiller/shared";
import type { SessionLegacyEvidenceState } from "../../../store";

type LegacyEvidencePanelProps = {
  state: SessionLegacyEvidenceState | undefined;
  onLoad: (source: LegacyEvidenceSource, after?: string) => void;
};

const SOURCE_LABELS: Record<LegacyEvidenceSource, string> = {
  message: "消息",
  tool_call: "工具",
  output: "输出",
};

const SOURCES: LegacyEvidenceSource[] = ["message", "tool_call", "output"];
const MAX_RENDERED_EVIDENCE_CHARS = 12_000;

export function LegacyEvidencePanel({ state, onLoad }: LegacyEvidencePanelProps) {
  const [activeSource, setActiveSource] = useState<LegacyEvidenceSource>("message");
  const availability = state?.availability;
  const page = state?.pages[activeSource];
  const loading = state?.loading[activeSource] === true;

  const loadSource = useCallback((source: LegacyEvidenceSource, after?: string) => {
    setActiveSource(source);
    onLoad(source, after);
  }, [onLoad]);

  const handleToggle = useCallback((event: ToggleEvent<HTMLDetailsElement>) => {
    if (event.currentTarget.open && !page && !loading) {
      onLoad(activeSource);
    }
  }, [activeSource, loading, onLoad, page]);

  if (!availability?.available) {
    return null;
  }

  const total = SOURCES.reduce((sum, source) => sum + availability.counts[source], 0);
  return (
    <details className="legacy-evidence-panel mt-3 rounded-md border border-border/60 bg-surface-sunken/40 p-2" onToggle={handleToggle}>
      <summary className="cursor-pointer list-none text-xs font-medium text-muted-foreground outline-none [&::-webkit-details-marker]:hidden">
        旧记录证据 · {total} 项
      </summary>
      <div className="mt-2 space-y-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="旧记录证据来源">
          {SOURCES.map((source) => (
            <button
              key={source}
              type="button"
              role="tab"
              aria-selected={source === activeSource}
              className={source === activeSource
                ? "rounded bg-primary/15 px-2 py-1 text-xs text-foreground"
                : "rounded px-2 py-1 text-xs text-muted-foreground hover:bg-surface-hover"}
              onClick={() => {
                setActiveSource(source);
                if (!state?.pages[source] && !state?.loading[source]) {
                  loadSource(source);
                }
              }}
            >
              {SOURCE_LABELS[source]} {availability.counts[source]}
            </button>
          ))}
        </div>
        {loading ? <p className="text-xs text-muted-foreground">正在读取原始记录…</p> : null}
        {page ? (
          <div className="space-y-2" role="tabpanel">
            {page.items.map((item) => (
              <pre
                key={`${item.source}:${item.sourcePosition}`}
                className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-background/70 p-2 text-2xs text-foreground"
              >
                {formatEvidenceEntity(item.entity)}
              </pre>
            ))}
            {page.issues.map((issue) => (
              <div key={`${issue.source}:${issue.sourcePosition}`} className="space-y-1 text-xs text-warning">
                <p>
                  第 {issue.sourcePosition} 条原始记录无法读取（{issue.code}）
                  {issue.payloadBytes ? `，${issue.payloadBytes} bytes` : ""}
                </p>
                {issue.preview ? (
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-background/70 p-2 text-2xs text-foreground">
                    {issue.preview}
                  </pre>
                ) : null}
              </div>
            ))}
            {!page.items.length && !page.issues.length && !loading ? (
              <p className="text-xs text-muted-foreground">该来源没有可显示的原始记录。</p>
            ) : null}
            {page.hasMore ? (
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => loadSource(activeSource, page.nextCursor)}
              >
                加载更多
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </details>
  );
}

function formatEvidenceEntity(entity: Record<string, unknown>) {
  const serialized = JSON.stringify(entity, null, 2) ?? "{}";
  return serialized.length > MAX_RENDERED_EVIDENCE_CHARS
    ? `${serialized.slice(0, MAX_RENDERED_EVIDENCE_CHARS)}\n…（展示已截断）`
    : serialized;
}
