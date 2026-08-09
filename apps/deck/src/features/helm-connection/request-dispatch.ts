import type { DebugTrace } from "../../store/facade";
import type { DeckRpcClient } from "./rpc-client";

export type DispatchToHelm = (
  client: DeckRpcClient,
  method: string,
  params: unknown,
  options?: { onResult?: (method: string, result: unknown) => void },
) => Promise<unknown>;

const REQUEST_TIMEOUT_OVERRIDES_MS: Record<string, number> = {
  "session/new": 180_000,
  "session/draft": 180_000,
  "session/resume": 180_000,
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
  return result;
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
    onUpdateCheckError?: (error: unknown) => void;
  },
) {
  const { dispatch, setSessionHistoryState, sessionPageLimit, onUpdateCheckError } = context;
  await dispatch(client, "helm/list", {});
  await dispatch(client, "project/list", {});
  await dispatch(client, "agent/list", {});
  await dispatch(client, "agent/connections", {});
  try {
    await dispatch(client, "daemon/update/check", {});
  } catch (error) {
    if (isMethodNotFound(error)) {
      // Older Helms do not expose the optional update method.
    } else {
      onUpdateCheckError?.(error);
    }
  }
  try {
    await dispatch(client, "logging/get", {});
  } catch {
    // Logging settings are optional during reconnect; inventory must still load.
  }
  setSessionHistoryState({ hasMore: false, loading: true });
  try {
    await dispatch(client, "session/list", { limit: sessionPageLimit });
  } catch (error) {
    setSessionHistoryState({ hasMore: false, loading: false });
    throw error;
  }
  try {
    await dispatch(client, "session/activity_summary", {});
  } catch {
    // Dashboard metrics are optional; keep the primary session inventory usable.
  }
  await dispatch(client, "approval/list_pending", {});
  await dispatch(client, "approval/list", { limit: 100 });
  await dispatch(client, "device/list", {});
}

function isMethodNotFound(error: unknown) {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: unknown }).code === -32601;
}

export async function subscribeToSessionTopic(
  client: DeckRpcClient,
  sessionId: string,
  dispatch: DispatchToHelm,
) {
  await dispatch(client, "session/subscribe", { sessionId });
}

export async function unsubscribeFromSessionTopic(
  client: DeckRpcClient,
  sessionId: string,
  dispatch: DispatchToHelm,
) {
  await dispatch(client, "session/unsubscribe", { sessionId });
}
