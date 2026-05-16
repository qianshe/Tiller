import type { DeckRpcClient, DispatchToHelm } from "../../helm-connection/facade";
import { toast } from "../../toast";

type MutableRef<T> = { current: T };

type QueuedPromptActionContext = {
  rpcClientRef: MutableRef<DeckRpcClient | null>;
  dispatch: DispatchToHelm;
};

function isClientOpen(client: DeckRpcClient | null): client is DeckRpcClient {
  return Boolean(client && client.socket.readyState === WebSocket.OPEN);
}

export function updateQueuedPrompt(
  sessionId: string,
  queueItemId: string,
  text: string,
  context: QueuedPromptActionContext,
) {
  const client = context.rpcClientRef.current;
  const nextText = text.trim();
  if (!nextText) {
    toast.warning("队列 Prompt 不能为空。");
    return;
  }
  if (!isClientOpen(client)) {
    toast.warning("Helm 未连接，无法修改队列 Prompt。");
    return;
  }
  void context.dispatch(client, "session/update_queued_prompt", {
    sessionId,
    queueItemId,
    text: nextText,
  });
}

export function deleteQueuedPrompt(
  sessionId: string,
  queueItemId: string,
  context: QueuedPromptActionContext,
) {
  const client = context.rpcClientRef.current;
  if (!isClientOpen(client)) {
    toast.warning("Helm 未连接，无法删除队列 Prompt。");
    return;
  }
  void context.dispatch(client, "session/delete_queued_prompt", {
    sessionId,
    queueItemId,
  });
}