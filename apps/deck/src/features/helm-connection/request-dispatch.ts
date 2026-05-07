import type { DebugTrace } from "../../store/facade";
import type { DeckRpcClient } from "./rpc-client";

export type DispatchToHelm = (
  client: DeckRpcClient,
  method: string,
  params: unknown,
  options?: { onResult?: (method: string, result: unknown) => void },
) => Promise<void>;

const REQUEST_TIMEOUT_OVERRIDES_MS: Record<string, number> = {
  "agent/get_model_options": 120_000,
};

export async function dispatchWithTrace(
  client: DeckRpcClient,
  method: string,
  params: unknown,
  setDebugTrace: (updater: (current: DebugTrace) => DebugTrace) => void,
  onResult?: (method: string, result: unknown) => void,
) {
  setDebugTrace((current) => ({
    ...current,
    requestsSent: current.requestsSent + 1,
    lastRequestType: method,
  }));
  if (method === "session/cancel") {
    client.notify(method, params);
    return;
  }
  const result = await client.request(method, params, {
    timeoutMs: REQUEST_TIMEOUT_OVERRIDES_MS[method],
  });
  onResult?.(method, result);
}

export async function requestInitialSync(
  client: DeckRpcClient,
  context: {
    dispatch: DispatchToHelm;
    setSessionHistoryState: (state: {
      nextCursor?: string;
      hasMore: boolean;
      loading: boolean;
    }) => void;
    sessionPageLimit: number;
  },
) {
  const { dispatch, setSessionHistoryState, sessionPageLimit } = context;
  await dispatch(client, "helm/list", {});
  await dispatch(client, "project/list", {});
  await dispatch(client, "workspace/list", {});
  await dispatch(client, "agent/list", {});
  setSessionHistoryState({ hasMore: false, loading: true });
  await dispatch(client, "session/list", { limit: sessionPageLimit });
  await dispatch(client, "device/list", {});
}
