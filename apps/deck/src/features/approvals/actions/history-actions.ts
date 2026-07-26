import type { ApprovalHistoryPage } from "@tiller/shared";
import { useDeckStore } from "../../../store";
import type {
  DeckRpcClient,
  DispatchToHelm,
} from "../../helm-connection/facade";

export async function clearProcessedApprovalHistory(
  client: DeckRpcClient | null,
  dispatch: DispatchToHelm,
): Promise<boolean> {
  if (!client || client.socket?.readyState !== 1) {
    useDeckStore.getState().addNotification({
      kind: "warning",
      source: "rpc",
      message: "Helm 未连接，无法清理权限记录。",
    });
    return false;
  }
  try {
    const result = await dispatch(client, "approval/clear_history", {}) as ApprovalHistoryPage;
    useDeckStore.getState().replaceApprovalHistory(result);
    return true;
  } catch (error) {
    useDeckStore.getState().addNotification({
      kind: "error",
      source: "rpc",
      message: `清理权限记录失败：${error instanceof Error ? error.message : String(error)}`,
    });
    return false;
  }
}
