import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  Icon,
  Tabs,
  TabsList,
  TabsTrigger,
  type ChartConfig,
} from "../../../../shared/ui";
import type {
  DashboardActivityTrendPoint,
  DashboardRecentActivitySummary,
} from "../../types";

type DashboardTrendRange = "30d" | "7d" | "1d";
type DashboardTrendField = "promptCount" | "toolCallCount";

const DASHBOARD_TREND_RANGES: Array<{
  value: DashboardTrendRange;
  label: string;
  description: string;
  days: number;
}> = [
  { value: "30d", label: "近1个月", description: "最近 1 个月", days: 30 },
  { value: "7d", label: "近1周", description: "最近 1 周", days: 7 },
  { value: "1d", label: "近1天", description: "最近 24 小时", days: 1 },
];

export type DashboardActivityTrendProps = {
  points?: DashboardActivityTrendPoint[];
  hourlyPoints?: DashboardActivityTrendPoint[];
  activitySummary?: DashboardRecentActivitySummary;
  recentPromptCount?: number;
  recentToolCallCount?: number;
};

function resolveRange(value: string): DashboardTrendRange {
  return DASHBOARD_TREND_RANGES.some((range) => range.value === value)
    ? value as DashboardTrendRange
    : "30d";
}

export function selectDashboardTrendPoints(
  points: DashboardActivityTrendPoint[],
  hourlyPoints: DashboardActivityTrendPoint[] | undefined,
  range: DashboardTrendRange,
) {
  if (range === "1d" && hourlyPoints?.length) {
    return hourlyPoints;
  }
  const days = DASHBOARD_TREND_RANGES.find((option) => option.value === range)?.days ?? 30;
  const visible = points.slice(-days);
  return visible.length > 0
    ? visible
    : [{ date: "", promptCount: 0, toolCallCount: 0 } satisfies DashboardActivityTrendPoint];
}

function formatDateLabel(date: string) {
  if (!date) return "—";
  if (date.includes("T")) {
    const timestamp = Date.parse(date);
    if (!Number.isNaN(timestamp)) {
      const hour = String(new Date(timestamp).getUTCHours()).padStart(2, "0");
      return `${hour}:00`;
    }
  }
  const [, month, day] = date.split("-");
  return month && day ? `${Number(month)}/${Number(day)}` : date;
}

function sumTrend(points: DashboardActivityTrendPoint[], field: DashboardTrendField) {
  return points.reduce((total, point) => total + point[field], 0);
}

function ActivitySparkline({ points }: { points: number[] }) {
  const visiblePoints = points.length > 0 ? points : Array.from({ length: 24 }, () => 0);
  const max = Math.max(1, ...visiblePoints);
  return (
    <svg
      width="180"
      height="20"
      viewBox={`0 0 ${visiblePoints.length * 6} 20`}
      className="h-5 w-20 shrink-0 text-primary sm:w-28"
      aria-hidden="true"
    >
      {visiblePoints.map((point, index) => {
        const height = point === 0 ? 2 : Math.max(3, (point / max) * 18);
        const opacity = point === 0 ? 0.2 : 0.45 + (point / max) * 0.55;
        return (
          <rect
            key={index}
            x={index * 6}
            y={20 - height}
            width="4"
            height={height}
            fill="currentColor"
            opacity={opacity}
            rx="1"
          />
        );
      })}
    </svg>
  );
}

type DashboardTrendChartProps = {
  points: DashboardActivityTrendPoint[];
  rangeLabel: string;
  promptTotal: number;
  toolTotal: number;
};

const TREND_CHART_CONFIG = {
  prompt: {
    label: "Prompt",
    color: "var(--primary)",
  },
  tools: {
    label: "工具调用",
    color: "var(--muted-foreground)",
  },
} satisfies ChartConfig;

function DashboardTrendChart({
  points,
  rangeLabel,
  promptTotal,
  toolTotal,
}: DashboardTrendChartProps) {
  const chartData = points.map((point) => ({
    date: point.date,
    prompt: point.promptCount,
    tools: point.toolCallCount,
  }));
  const hasActivity = chartData.some((point) => point.prompt > 0 || point.tools > 0);

  return (
    <div className="relative min-h-[280px] min-w-0" data-slot="dashboard-trend-chart">
      <ChartContainer
        config={TREND_CHART_CONFIG}
        className="h-[240px] min-h-[240px] w-full sm:h-[280px] sm:min-h-[280px]"
      >
        <AreaChart
          data={chartData}
          margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
          accessibilityLayer
        >
          <defs>
            <linearGradient id="dashboard-prompt-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-prompt)" stopOpacity={0.5} />
              <stop offset="95%" stopColor="var(--color-prompt)" stopOpacity={0.04} />
            </linearGradient>
            <linearGradient id="dashboard-tools-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-tools)" stopOpacity={0.32} />
              <stop offset="95%" stopColor="var(--color-tools)" stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={32}
            tickFormatter={(value) => formatDateLabel(String(value))}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            width={28}
            allowDecimals={false}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                labelFormatter={(value) => `${rangeLabel} · ${formatDateLabel(String(value))}`}
              />
            }
          />
          <Area
            dataKey="tools"
            type="monotone"
            fill="url(#dashboard-tools-fill)"
            fillOpacity={0.7}
            stroke="var(--color-tools)"
            strokeWidth={1.5}
          />
          <Area
            dataKey="prompt"
            type="monotone"
            fill="url(#dashboard-prompt-fill)"
            fillOpacity={0.9}
            stroke="var(--color-prompt)"
            strokeWidth={2}
          />
        </AreaChart>
      </ChartContainer>
      {!hasActivity ? (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-meta text-muted-foreground">
          暂无可用活动数据
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 px-3 pb-1 text-meta text-muted-foreground" data-slot="dashboard-trend-legend">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
          Prompt <span className="font-mono tabular text-foreground">{promptTotal}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-muted-foreground" aria-hidden="true" />
          工具调用 <span className="font-mono tabular text-foreground">{toolTotal}</span>
        </span>
      </div>
    </div>
  );
}

export function DashboardActivityTrend({
  points = [],
  hourlyPoints,
  activitySummary = { recentActivityCount: 0, sparklinePoints: [] },
  recentPromptCount = 0,
  recentToolCallCount = 0,
}: DashboardActivityTrendProps) {
  const [range, setRange] = useState<DashboardTrendRange>("30d");
  const defaultRange = DASHBOARD_TREND_RANGES[0]!;
  const selectedRange = DASHBOARD_TREND_RANGES.find((option) => option.value === range) ?? defaultRange;
  const visiblePoints = useMemo(
    () => selectDashboardTrendPoints(points, hourlyPoints, range),
    [hourlyPoints, points, range],
  );
  const promptTotal = sumTrend(visiblePoints, "promptCount");
  const toolTotal = sumTrend(visiblePoints, "toolCallCount");

  return (
    <Card
      className="dashboard-activity-trend wb-pane min-w-0 w-full shrink-0 overflow-hidden"
      data-slot="dashboard-activity-trend"
      aria-labelledby="dashboard-activity-trend-title"
    >
      <CardHeader className="relative flex flex-row flex-wrap items-start justify-between gap-3 px-4 pb-2 pt-4 sm:px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-sunken text-muted-foreground">
              <Icon name="chart" size={14} />
            </span>
            <CardTitle id="dashboard-activity-trend-title" className="text-section font-semibold text-foreground">
              Prompt 与工具调用
            </CardTitle>
          </div>
          <CardDescription className="mt-1 text-meta">{selectedRange.description}</CardDescription>
        </div>

        <Tabs
          value={range}
          onValueChange={(value) => setRange(resolveRange(value))}
          aria-label="活动趋势时间范围"
        >
          <TabsList size="sm" className="shrink-0 border border-border-ghost bg-surface-sunken p-0">
            {DASHBOARD_TREND_RANGES.map((option) => (
              <TabsTrigger
                key={option.value}
                value={option.value}
                size="sm"
                className="h-8 rounded-none px-3 text-meta first:rounded-l-md last:rounded-r-md data-[state=active]:bg-surface-emphasis data-[state=active]:text-foreground"
              >
                {option.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </CardHeader>

      <CardContent className="flex flex-col gap-3 px-4 pb-4 sm:px-5">
        <div
          className="grid min-w-0 grid-cols-1 gap-2 min-[420px]:grid-cols-3"
          data-slot="dashboard-trend-summary"
        >
        <div className="min-w-0 rounded-md border border-border-ghost bg-surface-sunken px-2.5 py-2 sm:px-3">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="truncate text-meta text-muted-foreground">近24h 活动</span>
            <ActivitySparkline points={activitySummary.sparklinePoints} />
          </div>
          <strong
            className="mt-1 block truncate font-mono text-lg font-semibold tabular text-foreground"
            data-slot="dashboard-recent-activity-summary"
          >
            {activitySummary.recentActivityCount}
          </strong>
        </div>
        <div className="min-w-0 rounded-md border border-border-ghost bg-surface-sunken px-2.5 py-2 sm:px-3">
          <span className="block truncate text-meta text-muted-foreground">近24h Prompt</span>
          <strong
            className="mt-1 block truncate font-mono text-lg font-semibold tabular text-foreground"
            data-slot="dashboard-recent-prompt-count"
          >
            {recentPromptCount}
          </strong>
        </div>
        <div className="min-w-0 rounded-md border border-border-ghost bg-surface-sunken px-2.5 py-2 sm:px-3">
          <span className="block truncate text-meta text-muted-foreground">近24h 工具调用</span>
          <strong
            className="mt-1 block truncate font-mono text-lg font-semibold tabular text-foreground"
            data-slot="dashboard-recent-tool-count"
          >
            {recentToolCallCount}
          </strong>
        </div>
        </div>

        <DashboardTrendChart
          points={visiblePoints}
          rangeLabel={selectedRange.label}
          promptTotal={promptTotal}
          toolTotal={toolTotal}
        />
      </CardContent>
    </Card>
  );
}
