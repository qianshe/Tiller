import type { FormEvent, MutableRefObject } from "react";
import type { AcpAgentProvider } from "@tiller/shared";
import type { DeckRpcClient, DispatchToHelm } from "../../helm-connection/facade";

type AgentActionCopy = {
  testRunningPrefix: string;
  savedDraft: string;
  writingConfig: string;
};

type AgentDraft = {
  name: string;
  command: string;
  args: string;
};

type TestAgentContext = {
  selectedAgentId?: string | null;
  filteredAgents: AcpAgentProvider[];
  agents: AcpAgentProvider[];
  rpcClientRef: MutableRefObject<DeckRpcClient | null>;
  setAgentTestResult: (value: string) => void;
  copy: Pick<AgentActionCopy, "testRunningPrefix">;
  dispatch: DispatchToHelm;
};

type SaveDraftContext = {
  storageKey: string;
  agentDraft: AgentDraft;
  setDraftSaveMessage: (value: string) => void;
  copy: Pick<AgentActionCopy, "savedDraft">;
};

type WriteDraftContext = {
  rpcClientRef: MutableRefObject<DeckRpcClient | null>;
  slugify: (value: string) => string;
  agentDraft: AgentDraft;
  setConfigSaveMessage: (value: string) => void;
  copy: Pick<AgentActionCopy, "writingConfig">;
  dispatch: DispatchToHelm;
  splitArgs: (value: string) => string[];
};

function getOpenClient(ref: MutableRefObject<DeckRpcClient | null>) {
  const client = ref.current;
  return client?.socket.readyState === WebSocket.OPEN ? client : null;
}

export function testAgent(context: TestAgentContext) {
  const {
    selectedAgentId,
    filteredAgents,
    agents,
    rpcClientRef,
    setAgentTestResult,
    copy,
    dispatch,
  } = context;

  const agentId = selectedAgentId || filteredAgents[0]?.id;
  const agent =
    filteredAgents.find((item) => item.id === agentId) ??
    agents.find((item) => item.id === agentId);
  const client = getOpenClient(rpcClientRef);
  if (!agent || !client) {
    return;
  }

  setAgentTestResult(`${copy.testRunningPrefix} ${agent.name}...`);
  void dispatch(client, "agent/test", { providerId: agent.id });
}

export function saveDraft(event: FormEvent<HTMLFormElement>, context: SaveDraftContext) {
  const { storageKey, agentDraft, setDraftSaveMessage, copy } = context;

  event.preventDefault();
  window.localStorage.setItem(storageKey, JSON.stringify(agentDraft));
  setDraftSaveMessage(
    `${copy.savedDraft} ${`${agentDraft.command} ${agentDraft.args}`.trim()}`,
  );
}

export function writeDraftToConfig(context: WriteDraftContext) {
  const {
    rpcClientRef,
    slugify,
    agentDraft,
    setConfigSaveMessage,
    copy,
    dispatch,
    splitArgs,
  } = context;

  const client = getOpenClient(rpcClientRef);
  if (!client) {
    return;
  }

  const providerId = slugify(
    agentDraft.name || agentDraft.command || "custom-agent",
  );
  setConfigSaveMessage(copy.writingConfig);
  void dispatch(client, "agent/save", {
    provider: {
      id: providerId,
      name: agentDraft.name || providerId,
      kind: "custom",
      command: agentDraft.command,
      args: splitArgs(agentDraft.args),
      installHint: `请确认命令 \`${agentDraft.command} ${agentDraft.args}\` 可以在终端运行。`,
    },
  });
}
