import type { AgentPlan, AgentPlanEntry } from "@tiller/shared";
import { Icon } from "../../../shared/ui";
import { cn } from "../../../shared/utils/cn";

type MissionPlanDrawerProps = {
  plan?: AgentPlan | null;
  placement?: "inline" | "floating";
};

export function MissionPlanDrawer({ plan, placement = "inline" }: MissionPlanDrawerProps) {
  if (!plan?.entries.length) {
    return null;
  }
  const summary = summarizeAgentPlan(plan);
  return (
    <details
      className={cn(
        "mission-plan-drawer rounded-[8px] border border-border-ghost bg-surface-sunken/55 px-3 py-2",
        placement === "floating" && "pointer-events-auto max-h-[min(32vh,260px)] overflow-y-auto bg-surface/95 shadow-[0_-14px_32px_rgb(0_0_0/0.18)]",
      )}
      data-plan-drawer-placement={placement}
      open
    >
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 text-xs font-semibold text-foreground [&::-webkit-details-marker]:hidden">
        <Icon name="check" size={14} className="text-primary" />
        <span className="min-w-0 truncate">{summary.label}</span>
        <Icon name="chevronDown" size={12} className="ml-auto text-muted-foreground/70" />
      </summary>
      <ol className="mt-2 grid gap-1.5 text-xs">
        {plan.entries.map((entry, index) => (
          <li key={`${index}:${entry.content}`} className="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-2">
            <span className={cn("mt-0.5 grid size-3.5 place-items-center rounded-sm border", resolveEntryTone(entry))}>
              {entry.status === "completed" ? <Icon name="check" size={10} /> : null}
            </span>
            <span className={cn("min-w-0 break-words leading-5", entry.status === "completed" && "text-muted-foreground line-through")}>
              {entry.content}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function summarizeAgentPlan(plan: AgentPlan) {
  const completed = plan.entries.filter((entry) => entry.status === "completed").length;
  const total = plan.entries.length;
  return {
    completed,
    total,
    label: `已完成 ${completed} 个任务（共 ${total} 个）`,
  };
}

function resolveEntryTone(entry: AgentPlanEntry) {
  if (entry.status === "completed") {
    return "border-primary/50 bg-primary/15 text-primary";
  }
  if (entry.status === "in_progress") {
    return "border-warning/60 bg-warning/15 text-warning";
  }
  return "border-border-strong bg-surface text-muted-foreground";
}
