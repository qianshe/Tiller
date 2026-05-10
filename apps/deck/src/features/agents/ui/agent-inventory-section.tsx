import type { Dispatch, SetStateAction } from "react";
import { Button, Input } from "@/shared/ui";
import type { AcpAgentProvider } from "@tiller/shared";
import type { DeckRpcClient, DispatchToHelm } from "../../helm-connection/facade";
import { slugify } from "../utils/fleet-helpers";

export type FleetAgentDraft = { id?: string; name: string; command: string; args: string[] };

type AgentInventorySectionProps = {
  connected: boolean;
  dispatch: DispatchToHelm;
  draft: FleetAgentDraft;
  emptyLabel: string;
  formOpen: boolean;
  selectedHelmAgents: AcpAgentProvider[];
  selectedHelmRpcClient: DeckRpcClient | null;
  setDraft: Dispatch<SetStateAction<FleetAgentDraft>>;
  setFormOpen: Dispatch<SetStateAction<boolean>>;
};

export function AgentInventorySection({
  connected,
  dispatch,
  draft,
  emptyLabel,
  formOpen,
  selectedHelmAgents,
  selectedHelmRpcClient,
  setDraft,
  setFormOpen,
}: AgentInventorySectionProps) {
  function cancelEdit() {
    setDraft({ name: "", command: "", args: [""] });
    setFormOpen(false);
  }

  return (
    <section className="grid content-start gap-3">
      <div className="grid min-h-9 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <h3 className="m-0 text-base font-semibold text-foreground">ACP 舰员</h3>
        <Button
          variant="outline"
          size="icon"
          type="button"
          disabled={!connected}
          aria-label="添加 ACP"
          title="添加 ACP"
          onClick={() => setFormOpen((current) => !current)}
        >
          +
        </Button>
      </div>
      {formOpen ? (
        <form
          className="grid w-full gap-3 rounded-md bg-surface-sunken p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!selectedHelmRpcClient || !draft.command.trim()) {
              return;
            }
            const providerId = draft.id ?? slugify(draft.name || draft.command);
            const existingAgent = draft.id
              ? selectedHelmAgents.find((agent) => agent.id === draft.id)
              : undefined;
            const agentArgs = draft.args
              .map((item) => item.trim())
              .filter(Boolean);
            void dispatch(selectedHelmRpcClient, "agent/save", {
              provider: {
                ...existingAgent,
                id: providerId,
                name: draft.name.trim() || existingAgent?.name || providerId,
                kind: existingAgent?.kind ?? "custom",
                command: draft.command.trim(),
                args: agentArgs,
                env: existingAgent?.env,
                cwd: existingAgent?.cwd,
                initializeTimeoutMs: existingAgent?.initializeTimeoutMs,
                defaultAgent: existingAgent?.defaultAgent,
                installHint: `请确认命令 \`${[draft.command.trim(), ...agentArgs].join(" ")}\` 可以在终端运行。`,
              },
            });
            setDraft({ name: "", command: "", args: [""] });
            setFormOpen(false);
          }}
        >
          <div className="grid grid-cols-[minmax(160px,1fr)_minmax(160px,1fr)_128px_auto] items-center gap-3 max-md:grid-cols-1">
            <Input
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              placeholder="舰员名称"
            />
            <Input
              value={draft.command}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  command: event.target.value,
                }))
              }
              placeholder="command"
            />
            <Button type="submit" disabled={!draft.command.trim()}>
              {draft.id ? "更新 ACP" : "保存 ACP"}
            </Button>
            <Button variant="outline" type="button" onClick={cancelEdit}>
              取消
            </Button>
          </div>
          <div className="grid gap-3 rounded-md border border-border-ghost bg-surface/60 p-3">
            <div className="flex items-center justify-between gap-3 font-semibold text-foreground">
              <span>args 数组</span>
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    args: [...current.args, ""],
                  }))
                }
              >
                + 参数
              </Button>
            </div>
            {draft.args.map((arg, index) => (
              <div
                className="grid grid-cols-[76px_minmax(0,1fr)_40px] items-center gap-2 max-md:grid-cols-1"
                key={`fleet-agent-arg-${index}`}
              >
                <span className="inline-flex min-h-10 items-center justify-center rounded-md border border-border-ghost bg-surface-sunken px-2 font-mono text-xs font-semibold text-muted-foreground max-md:justify-start">
                  args[{index}]
                </span>
                <Input
                  className="font-mono"
                  value={arg}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      args: current.args.map((item, itemIndex) =>
                        itemIndex === index ? event.target.value : item,
                      ),
                    }))
                  }
                  placeholder={index === 0 ? "acp" : "--pure"}
                />
                <Button
                  variant="outline"
                  size="icon"
                  type="button"
                  aria-label={`删除第 ${index + 1} 个参数`}
                  title="删除参数"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      args:
                        current.args.length > 1
                          ? current.args.filter(
                              (_, itemIndex) => itemIndex !== index,
                            )
                          : [""],
                    }))
                  }
                >
                  −
                </Button>
              </div>
            ))}
          </div>
        </form>
      ) : null}
      {selectedHelmAgents.length ? (
        <ul className="m-0 grid list-none divide-y divide-border-ghost border-t border-border-ghost p-0">
          {selectedHelmAgents.map((agent) => (
            <li key={agent.id} className="py-3">
              <details className="group grid gap-2">
                <summary className="grid cursor-pointer list-none grid-cols-[minmax(180px,0.35fr)_minmax(0,1fr)] items-baseline gap-3 marker:hidden max-md:grid-cols-1 max-md:gap-1 [&::-webkit-details-marker]:hidden">
                  <strong className="text-sm font-semibold text-foreground group-open:text-primary group-hover:text-primary">
                    {agent.name}
                  </strong>
                  <span className="[overflow-wrap:anywhere] text-sm text-muted-foreground">
                    {`${agent.command} ${(agent.args ?? []).join(" ")}`.trim()}
                  </span>
                </summary>
                <dl className="m-0 grid gap-2 rounded-md bg-surface-sunken p-3 text-sm">
                  <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 max-md:grid-cols-1 max-md:gap-1">
                    <dt className="font-semibold text-muted-foreground">Agent ID</dt>
                    <dd className="m-0 [overflow-wrap:anywhere] text-foreground">{agent.id}</dd>
                  </div>
                  <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 max-md:grid-cols-1 max-md:gap-1">
                    <dt className="font-semibold text-muted-foreground">Command</dt>
                    <dd className="m-0 [overflow-wrap:anywhere] text-foreground">{agent.command}</dd>
                  </div>
                  <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 max-md:grid-cols-1 max-md:gap-1">
                    <dt className="font-semibold text-muted-foreground">Arguments</dt>
                    <dd className="m-0 [overflow-wrap:anywhere] text-foreground">
                      {(agent.args ?? []).join(" ") || "-"}
                    </dd>
                  </div>
                  <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 max-md:grid-cols-1 max-md:gap-1">
                    <dt className="font-semibold text-muted-foreground">Transport</dt>
                    <dd className="m-0 [overflow-wrap:anywhere] text-foreground">{agent.transport}</dd>
                  </div>
                  <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 max-md:grid-cols-1 max-md:gap-1">
                    <dt className="font-semibold text-muted-foreground">Protocol</dt>
                    <dd className="m-0 [overflow-wrap:anywhere] text-foreground">{agent.protocol}</dd>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2 border-t border-border-ghost pt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      disabled={!connected}
                      aria-label={`编辑 ACP ${agent.name}`}
                      onClick={() => {
                        setDraft({
                          id: agent.id,
                          name: agent.name,
                          command: agent.command,
                          args: agent.args?.length ? agent.args : [""],
                        });
                        setFormOpen(true);
                      }}
                    >
                      编辑
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      disabled={!connected || !selectedHelmRpcClient}
                      aria-label={`删除 ACP ${agent.name}`}
                      onClick={() => {
                        if (!selectedHelmRpcClient) {
                          return;
                        }
                        void dispatch(selectedHelmRpcClient, "agent/delete", {
                          providerId: agent.id,
                        });
                      }}
                    >
                      删除
                    </Button>
                  </div>
                </dl>
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid min-h-16 place-items-center rounded-md bg-surface-sunken px-4 text-sm text-muted-foreground">
          {connected ? emptyLabel : "请先连接该 Helm 后加载舰员"}
        </div>
      )}
    </section>
  );
}
