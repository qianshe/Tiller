import type { FormEvent } from "react";
import { nextRequestId } from "../features/helm-connection/request-dispatch";

export function testAgent(context: any) {
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
    filteredAgents.find((item: any) => item.id === agentId) ??
    agents.find((item: any) => item.id === agentId);
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

export function saveDraft(event: FormEvent<HTMLFormElement>, context: any) {
  const { storageKey, agentDraft, setDraftSaveMessage, copy } = context;

  event.preventDefault();
  window.localStorage.setItem(storageKey, JSON.stringify(agentDraft));
  setDraftSaveMessage(
    `${copy.savedDraft} ${`${agentDraft.command} ${agentDraft.args}`.trim()}`,
  );
}

export function writeDraftToConfig(context: any) {
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
