import assert from "node:assert/strict";
import test from "node:test";
import { ErrorCode } from "@tiller/sync-protocol";
import type { HelmHandlerContext } from "../context";
import {
  checkDaemonUpdate,
  startDaemonUpdate,
} from "./update-rpc";
import { UpdateServiceError, type UpdateStatusEvent } from "../../updates/service";

function contextFor(error: UpdateServiceError): HelmHandlerContext {
  return {
    updateService: {
      check: async () => {
        throw error;
      },
      start: async () => {
        throw error;
      },
    },
    isLocalConnection: () => true,
  } as unknown as HelmHandlerContext;
}

test("update check broadcasts lifecycle status with a server timestamp", async () => {
  const broadcasts: Array<{ method: string; params: unknown }> = [];
  const context = {
    updateService: {
      check: async (
        _force: boolean,
        _connectionIsLocal: boolean,
        emitStatus: (status: UpdateStatusEvent) => void,
      ) => {
        emitStatus({
          status: "checking",
          currentVersion: "1.0.0",
          canUpdate: true,
        });
        return {
          currentVersion: "1.0.0",
          updateAvailable: false,
          canUpdate: true,
          checkStatus: "checked" as const,
        };
      },
      start: async () => {
        throw new Error("not used");
      },
    },
    isLocalConnection: () => true,
    broadcastNotification: (method: string, params: unknown) => broadcasts.push({ method, params }),
  } as unknown as HelmHandlerContext;

  await checkDaemonUpdate({ force: true }, context);

  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0]?.method, "daemon/update/status");
  assert.deepEqual(
    broadcasts[0]?.params && typeof broadcasts[0].params === "object"
      ? { ...(broadcasts[0].params as Record<string, unknown>), occurredAt: undefined }
      : broadcasts[0]?.params,
    {
      status: "checking",
      currentVersion: "1.0.0",
      canUpdate: true,
      occurredAt: undefined,
    },
  );
  assert.match(String((broadcasts[0]?.params as Record<string, unknown>)?.occurredAt), /^20/);
});

test("update start broadcasts status to the shared notification channel", async () => {
  const broadcasts: Array<{ method: string; params: unknown }> = [];
  const context = {
    updateService: {
      check: async () => ({
        currentVersion: "1.0.0",
        updateAvailable: false,
        canUpdate: true,
        checkStatus: "checked" as const,
      }),
      start: async (
        _connectionIsLocal: boolean,
        emitStatus: (status: UpdateStatusEvent) => void,
      ) => {
        emitStatus({
          status: "restarting",
          currentVersion: "1.0.0",
          canUpdate: true,
        });
        return { status: "restarting" as const, currentVersion: "1.0.0" };
      },
    },
    isLocalConnection: () => true,
    broadcastNotification: (method: string, params: unknown) => broadcasts.push({ method, params }),
  } as unknown as HelmHandlerContext;

  await startDaemonUpdate(context);

  assert.deepEqual(broadcasts.map(({ method }) => method), ["daemon/update/status"]);
  assert.equal((broadcasts[0]?.params as Record<string, unknown>)?.status, "restarting");
});

test("update check maps service failures to the public RPC error code", async () => {
  await assert.rejects(
    checkDaemonUpdate({}, contextFor(new UpdateServiceError("check-failed", "registry unavailable"))),
    (error: unknown) => {
      assert.deepEqual(error, {
        code: ErrorCode.UpdateCheckFailed,
        message: "registry unavailable",
      });
      return true;
    },
  );
});

test("update start maps duplicate work to the public RPC error code", async () => {
  await assert.rejects(
    startDaemonUpdate(contextFor(new UpdateServiceError("in-progress", "already updating"))),
    (error: unknown) => {
      assert.deepEqual(error, {
        code: ErrorCode.UpdateInProgress,
        message: "already updating",
      });
      return true;
    },
  );
});
