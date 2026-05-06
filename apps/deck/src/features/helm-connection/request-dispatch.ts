import type { MutableRefObject } from "react";
import type { ClientToHelm } from "@tiller/sync-protocol";
import type { DebugTrace } from "../../store/facade";
import type { DeckRpcClient } from "./rpc-client";

export type DispatchToHelm = (
  client: DeckRpcClient,
  method: string,
  params: unknown,
  options?: { onResult?: (method: string, result: unknown) => void },
) => Promise<void>;

export function nextRequestId(counter: MutableRefObject<number>) {
  counter.current += 1;
  return `req-${counter.current}`;
}

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
  const result = await client.request(method, params);
  onResult?.(method, result);
}

const LEGACY_METHODS: Record<string, string> = {
  "helm.list": "helm/list",
  "helm.save": "helm/save",
  "project.list": "project/list",
  "project.files.list": "project/list_files",
  "project.save": "project/save",
  "workspace.list": "workspace/list",
  "workspace.save": "workspace/save",
  "workspace.git.list": "workspace/git/list_branches",
  "workspace.git.create": "workspace/git/create_branch",
  "agent.list": "agent/list",
  "agent.test": "agent/test",
  "agent.model.options.get": "agent/get_model_options",
  "agent.save": "agent/save",
  "session.create": "session/new",
  "session.list": "session/list",
  "session.messages.list": "session/list_messages",
  "session.artifacts.get": "session/get_artifacts",
  "session.resume.check": "session/check_resume",
  "session.resume.start": "session/resume",
  "session.prompt": "session/prompt",
  "session.configure": "session/set_config_option",
  "permission.respond": "permission/respond",
  "session.cancel": "session/cancel",
  "session.cleanup": "session/cleanup",
  "device.list": "device/list",
  "device.revoke": "device/revoke",
  "device.pair": "device/pair",
  "device.auth": "device/authenticate",
};

export function mapLegacyPayloadToRpc(payload: ClientToHelm): { method: string; params: unknown } {
  const method = LEGACY_METHODS[payload.type];
  if (!method) {
    throw new Error(`Unsupported Helm payload type: ${payload.type}`);
  }
  const { type: _type, requestId: _requestId, ...params } = payload;
  return { method, params };
}

export async function dispatchLegacyPayloadWithTrace(
  client: DeckRpcClient,
  payload: ClientToHelm,
  setDebugTrace: (updater: (current: DebugTrace) => DebugTrace) => void,
  onResult?: (method: string, result: unknown) => void,
) {
  const { method, params } = mapLegacyPayloadToRpc(payload);
  await dispatchWithTrace(client, method, params, setDebugTrace, onResult);
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
