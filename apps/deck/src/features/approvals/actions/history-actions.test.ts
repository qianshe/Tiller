import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalApproval } from "@tiller/shared";
import { useDeckStore } from "../../../store";
import type {
  DeckRpcClient,
  DispatchToHelm,
} from "../../helm-connection/facade";
import { clearProcessedApprovalHistory } from "./history-actions";

function approval(
  id: string,
  status: CanonicalApproval["status"],
): CanonicalApproval {
  return {
    id,
    sessionId: "session-1",
    runtimeInstanceId: "runtime-1",
    sequence: 1,
    status,
    request: { id, command: "git status", reason: "inspect", cwd: "D:/repo" },
    createdAt: "2026-07-11T17:00:00.000Z",
    updatedAt: "2026-07-11T17:01:00.000Z",
  };
}

function connectedClient(): DeckRpcClient {
  return { socket: { readyState: 1 } } as DeckRpcClient;
}

test("clearProcessedApprovalHistory clears local processed records after Helm succeeds", async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const dispatch: DispatchToHelm = async (_client, method, params) => {
    calls.push({ method, params });
    return {
      ok: true,
      removed: 1,
      approvals: [approval("pending", "pending")],
      hasMore: false,
    };
  };
  useDeckStore.setState({
    approvalHistory: [approval("pending", "pending"), approval("resolved", "resolved")],
    notifications: [],
  });

  const result = await clearProcessedApprovalHistory(connectedClient(), dispatch);

  assert.equal(result, true);
  assert.deepEqual(calls, [{ method: "approval/clear_history", params: {} }]);
  assert.deepEqual(
    useDeckStore.getState().approvalHistory.map((item) => item.id),
    ["pending"],
  );
});

test("clearProcessedApprovalHistory preserves records and warns while disconnected", async () => {
  let dispatched = false;
  const dispatch: DispatchToHelm = async () => {
    dispatched = true;
    return undefined;
  };
  useDeckStore.setState({
    approvalHistory: [approval("resolved", "resolved")],
    notifications: [],
  });

  const result = await clearProcessedApprovalHistory(null, dispatch);

  assert.equal(result, false);
  assert.equal(dispatched, false);
  assert.deepEqual(
    useDeckStore.getState().approvalHistory.map((item) => item.id),
    ["resolved"],
  );
  assert.equal(
    useDeckStore.getState().notifications.at(-1)?.message,
    "Helm 未连接，无法清理权限记录。",
  );
});

test("clearProcessedApprovalHistory preserves records when Helm rejects cleanup", async () => {
  const dispatch: DispatchToHelm = async () => {
    throw new Error("cleanup failed");
  };
  useDeckStore.setState({
    approvalHistory: [approval("resolved", "resolved")],
    notifications: [],
  });

  const result = await clearProcessedApprovalHistory(connectedClient(), dispatch);

  assert.equal(result, false);
  assert.deepEqual(
    useDeckStore.getState().approvalHistory.map((item) => item.id),
    ["resolved"],
  );
  assert.equal(
    useDeckStore.getState().notifications.at(-1)?.message,
    "清理权限记录失败：cleanup failed",
  );
});
