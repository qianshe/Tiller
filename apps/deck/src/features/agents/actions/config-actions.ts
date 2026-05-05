import type { FormEvent, MutableRefObject } from "react";
import type { ClientToHelm } from "@tiller/sync-protocol";
import type { AcpAgentProvider } from "@tiller/shared";
import { nextRequestId } from "../../helm-connection/facade";

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

type DispatchToHelm = (socket: WebSocket, payload: ClientToHelm) => void;

type TestAgentContext = {
  selectedAgentId?: string | null;
  filteredAgents: AcpAgentProvider[];
  agents: AcpAgentProvider[];
  socketRef: MutableRefObject<WebSocket | null>;
  setAgentTestResult: (value: string) => void;
  copy: Pick<AgentActionCopy, "testRunningPrefix">;
  dispatch: DispatchToHelm;
  requestCounter: MutableRefObject<number>;
};

type SaveDraftContext = {
  storageKey: string;
  agentDraft: AgentDraft;
  setDraftSaveMessage: (value: string) => void;
  copy: Pick<AgentActionCopy, "savedDraft">;
};

type WriteDraftContext = {
  socketRef: MutableRefObject<WebSocket | null>;
  slugify: (value: string) => string;
  agentDraft: AgentDraft;
  setConfigSaveMessage: (value: string) => void;
  copy: Pick<AgentActionCopy, "writingConfig">;
  dispatch: DispatchToHelm;
  requestCounter: MutableRefObject<number>;
  splitArgs: (value: string) => string[];
};

export function testAgent(context: TestAgentContext) {
  const {
    selectedAgentId,
    filteredAgents,
    agents,
    socketRef,
    setAgentTestResult,
    copy,
    dispatch,
    requestCounter,
  } = context;

  const agentId = selectedAgentId || filteredAgents[0]?.id;
  const agent =
    filteredAgents.find((item) => item.id === agentId) ??
    agents.find((item) => item.id === agentId);
  if (!agent || !socketRef.current) {
    return;
  }

  setAgentTestResult(`${copy.testRunningPrefix} ${agent.name}...`);
  dispatch(socketRef.current, {
    type: "agent.test",
    requestId: nextRequestId(requestCounter),
    providerId: agent.id,
  });
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
    socketRef,
    slugify,
    agentDraft,
    setConfigSaveMessage,
    copy,
    dispatch,
    requestCounter,
    splitArgs,
  } = context;

  if (!socketRef.current) {
    return;
  }

  const providerId = slugify(
    agentDraft.name || agentDraft.command || "custom-agent",
  );
  setConfigSaveMessage(copy.writingConfig);
  dispatch(socketRef.current, {
    type: "agent.save",
    requestId: nextRequestId(requestCounter),
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
