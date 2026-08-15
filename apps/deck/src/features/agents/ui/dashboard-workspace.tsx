import type { ReactNode } from "react";
import { Badge, Button, Icon, StatusDot } from "@/shared/ui";
import { cn } from "@/shared/utils/cn";
import type { ConnectionState } from "../utils/helm-selection";
import type { HelmInventoryCounts } from "../utils/fleet-helpers";

export type DashboardHelmListItem = {
  key: string;
  name: string;
  endpoint: string;
  connection: ConnectionState;
  counts: HelmInventoryCounts;
};

export type DashboardAgentsWorkspaceProps = {
  screen: "list" | "detail";
  helms: DashboardHelmListItem[];
  detail: ReactNode;
  onSelectHelm: (key: string) => void;
  onAddHelm?: () => void;
};

function resolveConnectionTone(connection: ConnectionState): "active" | "primary" | "idle" {
  if (connection === "connected") return "active";
  if (connection === "connecting") return "primary";
  return "idle";
}

function HelmListRow({
  helm,
  onSelect,
}: {
  helm: DashboardHelmListItem;
  onSelect: () => void;
}) {
  return (
    <li className="border-b border-border-ghost last:border-b-0">
      <button
        type="button"
        className={cn(
          "group flex w-full min-w-0 items-center gap-3 px-4 py-4 text-left transition-colors",
          "hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset",
        )}
        onClick={onSelect}
        data-testid={`dashboard-helm-row-${helm.key}`}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border-ghost bg-surface-sunken text-muted-foreground">
          <Icon name="server" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-section font-semibold text-foreground">{helm.name}</span>
            <StatusDot tone={resolveConnectionTone(helm.connection)} pulse={helm.connection === "connecting"} />
          </span>
          <span className="mt-1 block truncate font-mono text-meta text-muted-foreground">{helm.endpoint}</span>
        </span>
        <span className="hidden shrink-0 items-center gap-2 sm:flex">
          <Badge variant="outline">{helm.counts.agents} Agents</Badge>
          <Badge variant="outline">{helm.counts.projects} 项目</Badge>
          <Badge variant="outline">{helm.counts.worktrees} 工作区</Badge>
        </span>
        <Icon
          name="chevronRight"
          className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
        />
      </button>
      <div className="flex flex-wrap gap-2 px-4 pb-4 pl-16 sm:hidden">
        <Badge variant="outline">{helm.counts.agents} Agents</Badge>
        <Badge variant="outline">{helm.counts.projects} 项目</Badge>
        <Badge variant="outline">{helm.counts.worktrees} 工作区</Badge>
      </div>
    </li>
  );
}

export function DashboardAgentsWorkspace({
  screen,
  helms,
  detail,
  onSelectHelm,
  onAddHelm,
}: DashboardAgentsWorkspaceProps) {
  if (screen === "detail") {
    return (
      <div
        className="dashboard-agents-detail flex h-full min-h-0 min-w-0 flex-1 overflow-hidden"
        data-testid="dashboard-agents-detail"
      >
        {detail}
      </div>
    );
  }

  return (
    <section
      className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden bg-canvas"
      data-testid="dashboard-agents-list"
      aria-label="Helm 列表"
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border-ghost px-4 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">Helm 列表</h2>
          <p className="mt-1 text-meta text-muted-foreground">选择一个运行节点管理 Agents 和项目</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-meta tabular text-muted-foreground">{helms.length} 个</span>
          {onAddHelm ? (
            <Button type="button" size="sm" onClick={onAddHelm}>
              <Icon name="plus" />
              添加 Helm
            </Button>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <ul className="overflow-hidden rounded-lg border border-border-ghost bg-surface" aria-label="可用 Helm">
          {helms.map((helm) => (
            <HelmListRow key={helm.key} helm={helm} onSelect={() => onSelectHelm(helm.key)} />
          ))}
        </ul>
      </div>
    </section>
  );
}
