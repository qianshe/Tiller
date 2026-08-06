import assert from "node:assert/strict";
import test from "node:test";
import { ErrorCode } from "@tiller/sync-protocol";
import type { HelmHandlerContext } from "../context";
import {
  checkDaemonUpdate,
  startDaemonUpdate,
} from "./update-rpc";
import { UpdateServiceError } from "../../updates/service";

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
