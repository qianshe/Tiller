import type { FormEvent } from "react";
import { saveDraft as saveDraftImpl, testAgent as testAgentImpl, writeDraftToConfig as writeDraftToConfigImpl } from "./config-actions";
import { AGENT_DRAFT_STORAGE_KEY } from "../config";

type UseAgentDraftActionsOptions = {
  selectedAgentId: string | null;
  filteredAgents: any[];
  agents: any[];
  rpcClientRef: any;
  setAgentTestResult: (value: string) => void;
  copy: any;
  dispatch: any;
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
  rpcClientRef,
  setAgentTestResult,
  copy,
  dispatch,
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
      rpcClientRef,
      setAgentTestResult,
      copy,
      dispatch,
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
      rpcClientRef,
      slugify,
      agentDraft,
      setConfigSaveMessage,
      copy,
      dispatch,
      splitArgs,
    });
  }

  return { saveDraft, testAgent, writeDraftToConfig };
}
