import { useEffect, useState } from "react";
import type { AgentPlan, AgentPlanEntry } from "@tiller/shared";
import { Icon } from "../../../shared/ui";
import { cn } from "../../../shared/utils/cn";

type MissionPlanDrawerProps = {
  plan?: AgentPlan | null;
  placement?: "inline" | "floating";
  onDismiss?: () => void;
};

export function MissionPlanDrawer({ plan, placement = "inline", onDismiss }: MissionPlanDrawerProps) {
  const entries = plan?.entries ?? [];
  const complete = isAgentPlanEntriesComplete(entries);
  const planStateKey = entries.map((entry) => `${entry.status}:${entry.content}`).join("\u001f");
  const [drawerState, setDrawerState] = useState(() => ({
    key: planStateKey,
    open: false,
  }));
  const open = drawerState.key === planStateKey ? drawerState.open : false;

  useEffect(() => {
    setDrawerState((current) => {
      const nextOpen = false;
      if (current.key === planStateKey && current.open === nextOpen) {
        return current;
      }
      return { key: planStateKey, open: nextOpen };
    });
  }, [complete, planStateKey]);

  if (!plan || entries.length === 0) {
    return null;
  }

  const summary = summarizeAgentPlan(plan);

  return (
    <details
      className={cn(
        "mission-plan-drawer rounded-[8px] border border-border-ghost bg-surface-sunken/55 px-3 py-2",
        placement === "floating" && "pointer-events-auto max-h-[min(32vh,260px)] overflow-y-auto bg-surface/95",
      )}
      data-plan-drawer-placement={placement}
      open={open}
      onToggle={(event) => setDrawerState({ key: planStateKey, open: event.currentTarget.open })}
    >
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2 text-xs font-semibold text-foreground [&::-webkit-details-marker]:hidden">
        <Icon name="check" size={14} className="text-primary" />
        <span className="min-w-0 truncate">{summary.label}</span>
        <Icon name="chevronDown" size={12} className="ml-auto text-muted-foreground/70" />
        {onDismiss ? (
          <button
            type="button"
            className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground transition hover:bg-surface-sunken hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
            aria-label="关闭 plan"
            title="关闭 plan"
            data-plan-dismiss
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onDismiss();
            }}
          >
            <Icon name="x" size={11} />
          </button>
        ) : null}
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

export function isAgentPlanComplete(plan: AgentPlan) {
  return isAgentPlanEntriesComplete(plan.entries);
}

export function createAgentPlanDismissalKey(plan: AgentPlan) {
  return [
    plan.updatedAt,
    ...plan.entries.map((entry) => `${entry.status}:${entry.priority}:${entry.content}`),
  ].join("\u001f");
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

function isAgentPlanEntriesComplete(entries: AgentPlanEntry[]) {
  return entries.length > 0 && entries.every((entry) => entry.status === "completed");
}
