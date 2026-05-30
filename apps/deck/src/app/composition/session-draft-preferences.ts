import { agentModelOptionsKey } from "../../features/agents/facade";
import type { DeckRpcClient } from "../../features/helm-connection";
import {
  applyConfigOptionValue,
  normalizeModelSelection,
  readConfigSelectionState,
  toConfigPatchState,
  type SessionConfigPreferencePatch,
} from "../../features/mission/facade";
import type { useMissionViewModel } from "../../features/mission";
import type { useDeckData } from "../state/deck-data";
import type { useAppRuntimeState } from "../state/runtime-state";

type RuntimeState = ReturnType<typeof useAppRuntimeState>;
type DeckData = ReturnType<typeof useDeckData>;
type MissionView = ReturnType<typeof useMissionViewModel>;

type DispatchToHelm = (
  client: DeckRpcClient,
  method: string,
  params: unknown,
  options?: { onResult?: (method: string, result: unknown) => void },
) => unknown;

export type SessionDraftPreferencesActionOptions = {
  runtimeState: RuntimeState;
  deckData: DeckData;
  missionView: MissionView;
  dispatch: DispatchToHelm;
};

export function createSessionDraftPreferencesAction({
  runtimeState,
  deckData,
  missionView,
  dispatch,
}: SessionDraftPreferencesActionOptions) {
  return (next: SessionConfigPreferencePatch) => {
    const activeSession = missionView.activeSession;
    const resolveConfigClient = (sessionHelmId?: string | null) => {
      const candidateHelmIds = [
        sessionHelmId,
        runtimeState.selectedMissionHelmId,
        runtimeState.primaryHelmKeyRef.current,
      ];
      for (const helmId of candidateHelmIds) {
        if (!helmId) continue;
        const helmClient = runtimeState.helmRpcClientRefs.current.get(helmId);
        if (helmClient?.socket.readyState === WebSocket.OPEN) {
          return helmClient;
        }
      }
      const directClient = runtimeState.rpcClientRef.current;
      return directClient?.socket.readyState === WebSocket.OPEN ? directClient : null;
    };
    const directConfigPatch = typeof next.configId === "string"
      ? { configId: next.configId, value: next.value }
      : null;

    if (activeSession) {
      const client = resolveConfigClient(activeSession.helmId);
      const activeConfigOptions = directConfigPatch
        ? applyConfigOptionValue(
            deckData.sessionConfigOptions[activeSession.id] ?? [],
            directConfigPatch.configId,
            directConfigPatch.value,
          )
        : [];
      const activeConfigState = directConfigPatch ? toConfigPatchState(next) : null;
      if (directConfigPatch) {
        deckData.setSessionConfigOptions((current) => ({
          ...current,
          [activeSession.id]: activeConfigOptions,
        }));
      }
      if (client) {
        void dispatch(client, "session/configure", {
          sessionId: activeSession.id,
          ...(directConfigPatch ? { ...directConfigPatch, ...activeConfigState } : {
            agentMode:
              next.agentMode ??
              activeSession.agentMode ??
              missionView.effectiveDraftAgentMode,
            model: normalizeModelSelection(
              next.model ?? activeSession.model ?? missionView.draftModel,
            ),
            reasoningEffort:
              next.reasoningEffort ??
              activeSession.reasoningEffort ??
              runtimeState.selectedReasoningEffort,
          }),
        });
      }
      return;
    }

    const draftKey =
      runtimeState.selectedAgentId && runtimeState.selectedCwd
        ? agentModelOptionsKey(
            runtimeState.selectedAgentId,
            runtimeState.selectedCwd,
            runtimeState.selectedProjectId,
          )
        : null;
    const draftEntry = draftKey ? deckData.agentModelOptions[draftKey] : undefined;
    const draftClient = resolveConfigClient(null);
    const draftConfigOptions = draftEntry && directConfigPatch
      ? applyConfigOptionValue(
          draftEntry.configOptions,
          directConfigPatch.configId,
          directConfigPatch.value,
        )
      : [];
    const draftConfigPatchState = draftEntry && directConfigPatch
      ? toConfigPatchState(next)
      : null;
    const draftConfigState = draftEntry && directConfigPatch
      ? {
          ...draftEntry.state,
          ...readConfigSelectionState(draftConfigOptions),
          ...draftConfigPatchState,
        }
      : null;
    if (draftKey && draftEntry && directConfigPatch) {
      deckData.setAgentModelOptions((current) => ({
        ...current,
        [draftKey]: {
          ...draftEntry,
          configOptions: draftConfigOptions,
          state: draftConfigState ?? draftEntry.state,
        },
      }));
    }
    if (draftEntry?.draftId && draftClient) {
      void dispatch(draftClient, "session/configure", {
        draftId: draftEntry.draftId,
        ...(directConfigPatch ? { ...directConfigPatch, ...draftConfigPatchState } : {
          agentMode: next.agentMode ?? missionView.effectiveDraftAgentMode,
          model: normalizeModelSelection(next.model ?? missionView.draftModel),
          reasoningEffort: next.reasoningEffort ?? runtimeState.selectedReasoningEffort,
        }),
      });
    }
    if (typeof next.agentMode === "string") {
      runtimeState.setSelectedAgentMode(next.agentMode);
    }
    if (typeof next.model === "string") {
      runtimeState.setSelectedModel(next.model);
    }
    if (next.reasoningEffort) {
      runtimeState.setSelectedReasoningEffort(next.reasoningEffort);
    }
  };
}
