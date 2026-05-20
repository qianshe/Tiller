import { Button, Icon, StatusDot } from "@/shared/ui";
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
): AgentsTreeCounts {
  if (helm.key === selectedHelm.key) {
    return selectedHelmCounts;
  }
  const inventory = helmInventories[helm.key];
  return {
    agents: inventory?.agents.length ?? 0,
    projects: inventory?.projects.length ?? 0,
    worktrees: inventory?.worktrees.length ?? 0,
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
}: AgentsTreeProps) {
  return (
    <aside className="agents-helm-tree wb-pane flex min-h-0 flex-col" aria-label="Helm 舰队树">
      <div className="wb-pane-head">
        <span className="wb-pane-head-eyebrow">Helm</span>
        <span className="ml-1 font-mono text-2xs tabular text-muted-foreground">{helmCards.length}</span>
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
            <button
              key={helm.key}
              type="button"
              role="listitem"
              className={`w-full rounded px-1.5 py-1 text-left transition-colors ${
                active ? "bg-surface-emphasis text-foreground" : "text-muted-foreground hover:bg-surface-sunken hover:text-foreground"
              }`}
              onClick={() => setSelectedHelmKey(helm.key)}
              aria-pressed={active}
              title={`${helm.name} · ${helm.host}:${helm.port}`}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <Icon
                  name="chevronDown"
                  size={12}
                  className={`transition-transform ${active ? "rotate-0" : "-rotate-90"}`}
                />
                <StatusDot tone={resolveTone(state)} pulse={state === "connecting"} />
                <Icon name="server" size={12} className="text-muted-foreground" />
                <strong className="flex-1 truncate text-[12.5px] font-medium">{helm.name}</strong>
                <span className="font-mono text-2xs tabular text-muted-foreground">{counts.agents}A</span>
              </span>
              {active ? (
                <span className="ml-10 mt-px grid gap-px">
                  <span className="flex h-5 items-center gap-1.5 rounded px-1.5 text-[12px] text-muted-foreground hover:bg-surface-sunken">
                    <Icon name="folder" size={11} />
                    {counts.projects} 项目
                  </span>
                  <span className="flex h-5 items-center gap-1.5 rounded px-1.5 text-[12px] text-muted-foreground hover:bg-surface-sunken">
                    <Icon name="board" size={11} />
                    {counts.worktrees} 工作区
                  </span>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {!isEmbeddedHelmDeck ? (
        <div className="border-t border-border-ghost p-1.5">
          <button
            type="button"
            className="flex h-7 w-full items-center gap-1.5 rounded px-2 text-[12px] text-muted-foreground hover:bg-surface-sunken hover:text-foreground"
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
