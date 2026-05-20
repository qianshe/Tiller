import type { SessionSummary } from "@tiller/shared";
import type { OverviewMetricItem } from "./overview-metrics";

type DashboardSectionProps = {
  className?: string;
  metrics: OverviewMetricItem[];
  metricsClassName?: string;
  latestSession: SessionSummary | null;
  latestSessionLabel: string;
  latestSessionTimeLabel: string;
  onOpenLatestSession: () => void;
};

export function DashboardSection({
  className = "overview-dashboard-section",
  metrics,
  metricsClassName = "overview-metrics-panel",
  latestSession,
  latestSessionLabel,
  latestSessionTimeLabel,
  onOpenLatestSession,
}: DashboardSectionProps) {
  return (
    <section className={`${className} wb-pane`} aria-label="Deck Dashboard">
      <div className="wb-pane-head">
        <div>
          <p className="wb-pane-head-eyebrow">dashboard</p>
          <h2 className="text-default font-semibold text-foreground">实时舰桥</h2>
        </div>
        {latestSession ? (
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary"
            onClick={onOpenLatestSession}
          >
            打开最新任务
          </button>
        ) : null}
      </div>

      <div className={`${metricsClassName} grid gap-2 sm:grid-cols-2 lg:grid-cols-3`} aria-label="Overview metrics">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-md bg-surface-sunken/70 p-3 ring-1 ring-border-ghost">
            <p className="text-2xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
              {metric.label}
            </p>
            <strong className="mt-1 block truncate text-sm text-foreground">{metric.value}</strong>
          </div>
        ))}
      </div>

      <div className="rounded-md bg-surface-elevated/70 p-3 ring-1 ring-border-ghost">
        <p className="text-2xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
          latest session
        </p>
        <p className="mt-1 text-sm font-semibold text-foreground">{latestSessionLabel}</p>
        <p className="mt-1 text-xs text-muted-foreground">{latestSessionTimeLabel}</p>
      </div>
    </section>
  );
}
