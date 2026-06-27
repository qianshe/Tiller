import assert from "node:assert/strict";
import test from "node:test";
import { createSessionDraftPreferencesAction } from "./session-draft-preferences";

function openClient() {
  return { socket: { readyState: WebSocket.OPEN } } as any;
}

test("createSessionDraftPreferencesAction configures an active session and updates local config options", () => {
  const client = openClient();
  const dispatched: Array<{ client: unknown; method: string; params: any }> = [];
  let sessionConfigOptions: any = {
    "session-1": [{ id: "model", category: "model", currentValue: "old-model" }],
  };
  const action = createSessionDraftPreferencesAction({
    runtimeState: {
      selectedMissionHelmId: null,
      primaryHelmKeyRef: { current: null },
      helmRpcClientRefs: { current: new Map() },
      rpcClientRef: { current: client },
      selectedReasoningEffort: "medium",
      setSelectedAgentMode: () => undefined,
      setSelectedModel: () => undefined,
      setSelectedReasoningEffort: () => undefined,
    } as any,
    deckData: {
      sessionConfigOptions,
      setSessionConfigOptions: (updater: any) => {
        sessionConfigOptions = updater(sessionConfigOptions);
      },
      agentModelOptions: {},
      setAgentModelOptions: () => undefined,
    } as any,
    missionView: {
      activeSession: {
        id: "session-1",
        helmId: null,
        agentMode: "default",
        model: "old-model",
        reasoningEffort: "medium",
      },
      effectiveDraftAgentMode: "default",
      draftModel: "draft-model",
    } as any,
    dispatch: (targetClient, method, params) => {
      dispatched.push({ client: targetClient, method, params });
    },
  });

  action({ configId: "model", value: "new-model" });

  assert.equal(sessionConfigOptions["session-1"][0].currentValue, "new-model");
  assert.deepEqual(dispatched, [
    {
      client,
      method: "session/configure",
      params: { sessionId: "session-1", configId: "model", value: "new-model" },
    },
  ]);
});

test("createSessionDraftPreferencesAction configures a runtime draft and mirrors selection state", () => {
  const client = openClient();
  const selected: Record<string, unknown> = {};
  const dispatched: Array<{ method: string; params: any }> = [];
  let agentModelOptions: any = {
    "codex::D:/repo::project-1": {
      draftId: "draft-1",
      configOptions: [{ id: "reasoning", category: "reasoning", currentValue: "low" }],
      state: { reasoningEffort: "low" },
    },
  };
  const action = createSessionDraftPreferencesAction({
    runtimeState: {
      selectedMissionHelmId: null,
      primaryHelmKeyRef: { current: null },
      helmRpcClientRefs: { current: new Map() },
      rpcClientRef: { current: client },
      selectedAgentId: "codex",
      selectedCwd: "D:/repo",
      selectedProjectId: "project-1",
      selectedReasoningEffort: "medium",
      setSelectedAgentMode: (value: string) => {
        selected.agentMode = value;
      },
      setSelectedModel: (value: string) => {
        selected.model = value;
      },
      setSelectedReasoningEffort: (value: string) => {
        selected.reasoningEffort = value;
      },
    } as any,
    deckData: {
      sessionConfigOptions: {},
      setSessionConfigOptions: () => undefined,
      agentModelOptions,
      setAgentModelOptions: (updater: any) => {
        agentModelOptions = updater(agentModelOptions);
      },
    } as any,
    missionView: {
      activeSession: null,
      effectiveDraftAgentMode: "plan",
      draftModel: "gpt-5",
    } as any,
    dispatch: (_targetClient, method, params) => {
      dispatched.push({ method, params });
    },
  });

  action({ configId: "reasoning", value: "high", reasoningEffort: "high" });

  assert.equal(agentModelOptions["codex::D:/repo::project-1"].configOptions[0].currentValue, "high");
  assert.equal(agentModelOptions["codex::D:/repo::project-1"].state.reasoningEffort, "high");
  assert.deepEqual(dispatched, [
    {
      method: "session/configure",
      params: { draftId: "draft-1", configId: "reasoning", value: "high", reasoningEffort: "high" },
    },
  ]);
  assert.deepEqual(selected, { reasoningEffort: "high" });
});
