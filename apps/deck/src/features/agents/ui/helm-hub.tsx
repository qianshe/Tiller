import { Button, Card, CardContent, CardHeader, CardTitle } from "@/shared/ui";
import { cn } from "@/shared/utils/cn";
import type { DaemonProfile } from "../../helm-connection/facade";
import { resolveHelmConnectionState } from "../utils/fleet-helpers";

type ConnectionState = "connecting" | "connected" | "disconnected";

export type HelmCard = {
  key: string;
  name: string;
  host: string;
  port: string;
  isCurrent: boolean;
  profile: DaemonProfile | null;
};

type HelmHubProps = {
  connection: ConnectionState;
  currentHelmKey: string;
  helmCards: HelmCard[];
  helmConnectionStates: Record<string, ConnectionState>;
  isEmbeddedHelmDeck: boolean;
  onAddHelm: () => void;
  selectedHelm: HelmCard;
  setSelectedHelmKey: (key: string) => void;
};

export function HelmHub({
  connection,
  currentHelmKey,
  helmCards,
  helmConnectionStates,
  isEmbeddedHelmDeck,
  onAddHelm,
  selectedHelm,
  setSelectedHelmKey,
}: HelmHubProps) {
  return (
    <Card className="grid gap-4 p-4 shadow-card" aria-label="舰队 Helm 节点">
      <CardHeader className="flex-row items-start justify-between gap-3 p-0">
        <div>
          <div className="flex items-center gap-2">
            <CardTitle>Helm</CardTitle>
            <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-muted-foreground">
              {helmCards.length} Helm
            </span>
          </div>
        </div>
        {!isEmbeddedHelmDeck ? (
          <Button type="button" onClick={onAddHelm}>
            添加
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-4 p-0">
        <p className="m-0 text-sm leading-relaxed text-muted-foreground">
          {isEmbeddedHelmDeck
            ? "当前内置 Deck 只管理这个 Helm；多 Helm 控制台由公版 Web 承载。"
            : "管理多个 Helm 节点；选择后查看项目、ACP 舰员与信标。"}
        </p>
        <div
          className="grid grid-cols-[repeat(auto-fit,minmax(132px,1fr))] gap-2"
          role="list"
          aria-label="Helm 节点列表"
        >
          {helmCards.map((helm) => {
            const state = resolveHelmConnectionState(
              helm,
              currentHelmKey,
              connection,
              helmConnectionStates,
            );
            return (
              <button
                className={cn(
                  "flex min-h-12 items-center gap-2 rounded-md border border-border-ghost bg-surface-sunken px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-surface-emphasis focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                  selectedHelm.key === helm.key &&
                    "border-primary bg-primary-soft text-primary",
                )}
                key={helm.key}
                type="button"
                role="listitem"
                onClick={() => setSelectedHelmKey(helm.key)}
                aria-pressed={selectedHelm.key === helm.key}
                title={`${helm.name} · ${helm.host}:${helm.port}`}
              >
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full bg-muted-foreground",
                    state === "connected" && "bg-success",
                    state === "connecting" && "bg-warning",
                    state === "disconnected" && "bg-muted-foreground",
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0 truncate">{helm.name}</span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
