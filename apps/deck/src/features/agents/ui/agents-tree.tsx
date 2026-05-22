import { Button, Icon, StatusDot, AgentIcon } from "@/shared/ui";
import type { ConnectionState, HelmInventoryBucket } from "../utils/helm-selection";
import { resolveHelmConnectionState } from "../utils/fleet-helpers";
import type { HelmCard } from "./helm-hub";

type AgentsTreeCounts = {
  agents: number;
  projects: number;
  worktrees: number;
};

type AgentsTreeProps = {
  connection: ConnectionState;
  currentHelmKey: string;
  helmCards: HelmCard[];
  helmConnectionStates: Record<string, ConnectionState>;
  helmInventories: Record<string, HelmInventoryBucket>;
  isEmbeddedHelmDeck: boolean;
  onAddHelm: () => void;
  selectedHelm: HelmCard;
  selectedHelmCounts: AgentsTreeCounts;
  setSelectedHelmKey: (key: string) => void;
  isMobile?: boolean;
};

function resolveTone(state: ConnectionState): "active" | "idle" | "warning" {
  if (state === "connected") return "active";
  if (state === "connecting") return "warning";
  return "idle";
}

function countsForHelm(
  helm: HelmCard,
  selectedHelm: HelmCard,
  selectedHelmCounts: AgentsTreeCounts,
  helmInventories: Record<string, HelmInventoryBucket>,
) {
  const inventory = helmInventories[helm.key];
  const sessionsCount = inventory?.sessions?.length ?? 0;
  if (helm.key === selectedHelm.key) {
    return {
      agents: selectedHelmCounts.agents,
      projects: selectedHelmCounts.projects,
      worktrees: selectedHelmCounts.worktrees,
      sessions: sessionsCount,
    };
  }
  return {
    agents: inventory?.agents?.length ?? 0,
    projects: inventory?.projects?.length ?? 0,
    worktrees: inventory?.worktrees?.length ?? 0,
    sessions: sessionsCount,
  };
}

export function AgentsTree({
  connection,
  currentHelmKey,
  helmCards,
  helmConnectionStates,
  helmInventories,
  isEmbeddedHelmDeck,
  onAddHelm,
  selectedHelm,
  selectedHelmCounts,
  setSelectedHelmKey,
  isMobile = false,
}: AgentsTreeProps) {
  if (isMobile) {
    return (
      <aside className="agents-helm-tree wb-pane flex min-h-0 flex-col flex-1 overflow-hidden" aria-label="Helm 舰队树">
        <div className="wb-pane-head">
          <span className="wb-pane-head-eyebrow">Helm</span>
          <span className="font-mono text-2xs text-muted-foreground tabular ml-1">{helmCards.length}</span>
          <div className="flex-1" />
          {!isEmbeddedHelmDeck ? (
            <button
              type="button"
              className="h-7 w-7 grid place-items-center rounded hover:bg-surface-sunken"
              onClick={onAddHelm}
              title="添加 Helm"
            >
              <Icon name="plus" size={14} className="text-muted-foreground" />
            </button>
          ) : null}
        </div>
        <div className="flex-1 overflow-auto p-1" role="list" aria-label="Helm 节点列表">
          {helmCards.map((helm) => {
            const state = resolveHelmConnectionState(
              helm,
              currentHelmKey,
              connection,
              helmConnectionStates,
            );
            const counts = countsForHelm(helm, selectedHelm, selectedHelmCounts, helmInventories);
            return (
              <button
                key={helm.key}
                type="button"
                role="listitem"
                onClick={() => setSelectedHelmKey(helm.key)}
                className="w-full flex items-center gap-2 px-2 h-12 rounded hover:bg-surface-sunken active:bg-surface-emphasis text-left transition-colors"
                title={`${helm.name} · ${helm.host}:${helm.port}`}
              >
                <StatusDot tone={resolveTone(state)} pulse={state === "connecting"} />
                <Icon name="server" size={14} className="text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate text-foreground">{helm.name}</div>
                  <div className="font-mono text-2xs text-muted-foreground tabular truncate">{helm.host}:{helm.port}</div>
                </div>
                <div className="font-mono text-2xs text-muted-foreground tabular text-right shrink-0 leading-tight">
                  <div>{counts.agents}A · {counts.projects}P</div>
                  <div>{counts.sessions} sess</div>
                </div>
                <Icon name="chevronRight" size={14} className="text-muted-foreground" />
              </button>
            );
          })}
        </div>
        {!isEmbeddedHelmDeck ? (
          <div className="border-t border-border-ghost p-2">
            <button
              type="button"
              onClick={onAddHelm}
              className="w-full flex items-center justify-center gap-1.5 h-10 px-2 rounded text-section text-muted-foreground hover:text-foreground hover:bg-surface-sunken transition-colors"
            >
              <Icon name="plus" size={14} /> 配对新 Helm
            </button>
          </div>
        ) : null}
      </aside>
    );
  }

  return (
    <aside className="agents-helm-tree wb-pane flex min-h-0 flex-col" aria-label="Helm 舰队树">
      <div className="wb-pane-head">
        <span className="wb-pane-head-eyebrow">Helm</span>
        <span className="ml-1 font-mono text-meta tabular text-muted-foreground">{helmCards.length}</span>
        <div className="flex-1" />
        {!isEmbeddedHelmDeck ? (
          <Button type="button" size="icon-sm" variant="ghost" onClick={onAddHelm} title="添加 Helm">
            <Icon name="plus" size={12} />
          </Button>
        ) : null}
      </div>
      <div className="flex-1 overflow-auto p-1" role="list" aria-label="Helm 节点列表">
        {helmCards.map((helm) => {
          const state = resolveHelmConnectionState(
            helm,
            currentHelmKey,
            connection,
            helmConnectionStates,
          );
          const active = selectedHelm.key === helm.key;
          const counts = countsForHelm(helm, selectedHelm, selectedHelmCounts, helmInventories);
          return (
            <div key={helm.key}>
              <button
                type="button"
                role="listitem"
                className={`flex h-6 w-full items-center gap-1.5 rounded px-1.5 text-left transition-colors ${
                  active ? "bg-surface-emphasis text-foreground" : "text-muted-foreground hover:bg-surface-sunken hover:text-foreground"
                }`}
                onClick={() => setSelectedHelmKey(helm.key)}
                aria-pressed={active}
                title={`${helm.name} · ${helm.host}:${helm.port}`}
              >
                <Icon
                  name="chevronDown"
                  size={12}
                  className={`transition-transform ${active ? "rotate-0" : "-rotate-90"}`}
                />
                <StatusDot tone={resolveTone(state)} pulse={state === "connecting"} />
                <Icon name="server" size={12} className="text-muted-foreground" />
                <strong className="flex-1 truncate text-section font-medium">{helm.name}</strong>
                <span className="font-mono text-meta tabular text-muted-foreground">{counts.agents}A</span>
              </button>
              {active ? (
                <div className="ml-4 mt-px mb-1 grid gap-px">
                  {(helmInventories[helm.key]?.agents ?? []).map((a) => (
                    <span
                      key={a.id}
                      className="flex h-5 items-center gap-1.5 rounded px-1.5 text-action text-muted-foreground hover:bg-surface-sunken"
                    >
                      <AgentIcon name={a.name} size={11} />
                      <span className="text-action truncate flex-1">{a.name}</span>
                      <span className="font-mono text-2xs text-muted-foreground tabular truncate">{a.command}</span>
                    </span>
                  ))}
                  <span className="flex h-5 items-center gap-1.5 rounded px-1.5 text-action text-muted-foreground hover:bg-surface-sunken">
                    <Icon name="folder" size={11} />
                    {counts.projects} 项目
                  </span>
                  <span className="flex h-5 items-center gap-1.5 rounded px-1.5 text-action text-muted-foreground hover:bg-surface-sunken">
                    <Icon name="board" size={11} />
                    {counts.worktrees} 工作区
                  </span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {!isEmbeddedHelmDeck ? (
        <div className="border-t border-border-ghost p-1.5">
          <button
            type="button"
            className="flex h-7 w-full items-center gap-1.5 rounded px-2 text-action text-muted-foreground hover:bg-surface-sunken hover:text-foreground"
            onClick={onAddHelm}
          >
            <Icon name="plus" size={12} />
            配对新 Helm
          </button>
        </div>
      ) : null}
    </aside>
  );
}
