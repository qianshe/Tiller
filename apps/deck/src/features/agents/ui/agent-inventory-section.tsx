import type { Dispatch, SetStateAction } from "react";
import type { AcpAgentProvider } from "@tiller/shared";
import type { DeckRpcClient, DispatchToHelm } from "../../helm-connection/facade";
import { slugify } from "../utils/fleet-helpers";

export type FleetAgentDraft = { name: string; command: string; args: string[] };

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
  return (
    <section className="helm-inventory-list-section">
      <div className="helm-inventory-section-head">
        <h3>ACP 舰员</h3>
        <div className="helm-section-actions-inline">
          <button
            className="secondary helm-list-add-button"
            type="button"
            disabled={!connected}
            aria-label="添加 ACP"
            title="添加 ACP"
            onClick={() => setFormOpen((current) => !current)}
          >
            +
          </button>
        </div>
      </div>
      {formOpen ? (
        <form
          className="helm-inline-add-form helm-inline-add-form-agent"
          onSubmit={(event) => {
            event.preventDefault();
            if (!selectedHelmRpcClient || !draft.command.trim()) {
              return;
            }
            const providerId = slugify(draft.name || draft.command);
            const agentArgs = draft.args
              .map((item) => item.trim())
              .filter(Boolean);
            void dispatch(selectedHelmRpcClient, "agent/save", {
              provider: {
                id: providerId,
                name: draft.name.trim() || providerId,
                kind: "custom",
                command: draft.command.trim(),
                args: agentArgs,
                installHint: `请确认命令 \`${[draft.command.trim(), ...agentArgs].join(" ")}\` 可以在终端运行。`,
              },
            });
            setDraft({ name: "", command: "", args: [""] });
            setFormOpen(false);
          }}
        >
          <div className="helm-agent-core-row">
            <input
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              placeholder="舰员名称"
            />
            <input
              value={draft.command}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  command: event.target.value,
                }))
              }
              placeholder="command"
            />
            <button
              className="primary"
              type="submit"
              disabled={!draft.command.trim()}
            >
              保存 ACP
            </button>
          </div>
          <div className="helm-agent-args-column">
            <div className="helm-agent-args-head">
              <span>args 数组</span>
              <button
                className="secondary helm-arg-action-button"
                type="button"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    args: [...current.args, ""],
                  }))
                }
              >
                + 参数
              </button>
            </div>
            {draft.args.map((arg, index) => (
              <div
                className="helm-agent-arg-row"
                key={`fleet-agent-arg-${index}`}
              >
                <span className="helm-agent-arg-index">args[{index}]</span>
                <input
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
                <button
                  className="secondary helm-arg-icon-button"
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
                </button>
              </div>
            ))}
          </div>
        </form>
      ) : null}
      {selectedHelmAgents.length ? (
        <ul className="helm-simple-list">
          {selectedHelmAgents.map((agent) => (
            <li key={agent.id}>
              <details className="helm-simple-detail-row">
                <summary>
                  <strong>{agent.name}</strong>
                  <span>
                    {`${agent.command} ${(agent.args ?? []).join(" ")}`.trim()}
                  </span>
                </summary>
                <dl>
                  <div>
                    <dt>Agent ID</dt>
                    <dd>{agent.id}</dd>
                  </div>
                  <div>
                    <dt>Command</dt>
                    <dd>{agent.command}</dd>
                  </div>
                  <div>
                    <dt>Arguments</dt>
                    <dd>{(agent.args ?? []).join(" ") || "-"}</dd>
                  </div>
                  <div>
                    <dt>Transport</dt>
                    <dd>{agent.transport}</dd>
                  </div>
                  <div>
                    <dt>Protocol</dt>
                    <dd>{agent.protocol}</dd>
                  </div>
                </dl>
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty-state">
          {connected ? emptyLabel : "请先连接该 Helm 后加载舰员"}
        </div>
      )}
    </section>
  );
}
