import * as React from "react";
import * as RechartsPrimitive from "recharts";
import { cn } from "@/shared/utils/cn";

export type ChartConfig = Record<string, {
  label?: React.ReactNode;
  color?: string;
  icon?: React.ComponentType;
}>;

const ChartContext = React.createContext<ChartConfig | null>(null);

function useChartConfig() {
  const config = React.useContext(ChartContext);
  if (!config) {
    throw new Error("useChartConfig must be used within a ChartContainer");
  }
  return config;
}

export const ChartContainer = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    config: ChartConfig;
    children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"];
  }
>(({ className, children, config, style, ...props }, ref) => {
  const chartStyles = Object.fromEntries(
    Object.entries(config)
      .filter(([, item]) => item.color)
      .map(([key, item]) => [`--color-${key}`, item.color]),
  ) as React.CSSProperties;

  return (
    <ChartContext.Provider value={config}>
      <div
        ref={ref}
        className={cn(
          "flex min-h-0 w-full justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border-ghost [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border-ghost [&_.recharts-layer]:outline-none [&_.recharts-surface]:outline-none",
          className,
        )}
        style={{ ...chartStyles, ...style }}
        {...props}
      >
        <RechartsPrimitive.ResponsiveContainer width="100%" height="100%">
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
});
ChartContainer.displayName = "ChartContainer";

export const ChartTooltip = RechartsPrimitive.Tooltip;

type ChartPayloadItem = {
  dataKey?: string | number;
  name?: string | number;
  value?: string | number;
  color?: string;
};

export const ChartTooltipContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    active?: boolean;
    payload?: readonly ChartPayloadItem[];
    label?: string | number;
    labelFormatter?: (label: string | number, payload: readonly ChartPayloadItem[]) => React.ReactNode;
    indicator?: "line" | "dot";
  }
>(({ active, payload, label, labelFormatter, indicator = "dot", className, ...props }, ref) => {
  const config = useChartConfig();
  if (!active || !payload?.length) return null;

  const formattedLabel = labelFormatter ? labelFormatter(label ?? "", payload) : label;

  return (
    <div
      ref={ref}
      className={cn(
        "grid min-w-32 gap-1.5 rounded-lg border border-border-ghost bg-surface px-2.5 py-1.5 text-xs shadow-xl",
        className,
      )}
      {...props}
    >
      {formattedLabel ? <div className="font-medium text-foreground">{formattedLabel}</div> : null}
      <div className="grid gap-1.5">
        {payload.map((item, index) => {
          const key = String(item.dataKey ?? item.name ?? index);
          const itemConfig = config[key];
          const color = item.color ?? itemConfig?.color ?? "var(--muted-foreground)";
          return (
            <div key={`${key}-${index}`} className="flex items-center gap-2">
              <span
                className={cn(
                  "shrink-0 rounded-[2px]",
                  indicator === "dot" ? "size-2" : "h-3 w-0.5",
                )}
                style={{ backgroundColor: color }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {itemConfig?.label ?? item.name ?? key}
              </span>
              <span className="font-mono font-medium tabular-nums text-foreground">
                {item.value ?? 0}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
});
ChartTooltipContent.displayName = "ChartTooltipContent";
