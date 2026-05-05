import type { FormEvent } from "react";
import { saveDraft as saveDraftImpl, testAgent as testAgentImpl, writeDraftToConfig as writeDraftToConfigImpl } from "./config-actions";
import { AGENT_DRAFT_STORAGE_KEY } from "../config";

type UseAgentDraftActionsOptions = {
  selectedAgentId: string | null;
  filteredAgents: any[];
  agents: any[];
  socketRef: { current: WebSocket | null };
  setAgentTestResult: (value: string) => void;
  copy: any;
  dispatch: (socket: WebSocket, payload: any) => void;
  requestCounter: { current: number };
  agentDraft: { name: string; command: string; args: string };
  setDraftSaveMessage: (value: string) => void;
  setConfigSaveMessage: (value: string) => void;
  slugify: (value: string) => string;
  splitArgs: (value: string) => string[];
};

export function useAgentDraftActions({
  selectedAgentId,
  filteredAgents,
  agents,
  socketRef,
  setAgentTestResult,
  copy,
  dispatch,
  requestCounter,
  agentDraft,
  setDraftSaveMessage,
  setConfigSaveMessage,
  slugify,
  splitArgs,
}: UseAgentDraftActionsOptions) {
  function testAgent() {
    testAgentImpl({
      selectedAgentId,
      filteredAgents,
      agents,
      socketRef,
      setAgentTestResult,
      copy,
      dispatch,
      requestCounter,
    });
  }

  function saveDraft(event: FormEvent<HTMLFormElement>) {
    saveDraftImpl(event, {
      storageKey: AGENT_DRAFT_STORAGE_KEY,
      agentDraft,
      setDraftSaveMessage,
      copy,
    });
  }

  function writeDraftToConfig() {
    writeDraftToConfigImpl({
      socketRef,
      slugify,
      agentDraft,
      setConfigSaveMessage,
      copy,
      dispatch,
      requestCounter,
      splitArgs,
    });
  }

  return { saveDraft, testAgent, writeDraftToConfig };
}
