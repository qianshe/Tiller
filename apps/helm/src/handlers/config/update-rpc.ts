import { ErrorCode, rpcError, type ErrorCodeValue } from "@tiller/sync-protocol";
import type { HelmHandlerContext } from "../context";
import {
  UpdateServiceError,
  type UpdateStatusEvent,
  type UpdateServiceErrorKind,
} from "../../updates/service";

export async function checkDaemonUpdate(
  params: { force?: boolean },
  context: HelmHandlerContext,
) {
  if (!context.updateService) {
    throw rpcError(ErrorCode.UpdateNotSupported, "Helm update service is unavailable.");
  }
  try {
    return await context.updateService.check(
      Boolean(params.force),
      context.isLocalConnection?.() ?? false,
      createConnectionStatusEmitter(context),
    );
  } catch (error) {
    throw toRpcError(error);
  }
}

export async function startDaemonUpdate(context: HelmHandlerContext) {
  if (!context.updateService) {
    throw rpcError(ErrorCode.UpdateNotSupported, "Helm update service is unavailable.");
  }
  try {
    return await context.updateService.start(
      context.isLocalConnection?.() ?? false,
      createConnectionStatusEmitter(context),
    );
  } catch (error) {
    throw toRpcError(error);
  }
}

function toRpcError(error: unknown) {
  if (!(error instanceof UpdateServiceError)) return error;
  const errorCodes: Record<UpdateServiceErrorKind, ErrorCodeValue> = {
    "check-failed": ErrorCode.UpdateCheckFailed,
    "not-supported": ErrorCode.UpdateNotSupported,
    "in-progress": ErrorCode.UpdateInProgress,
    "start-failed": ErrorCode.UpdateStartFailed,
  };
  return rpcError(errorCodes[error.kind], error.message);
}

function createConnectionStatusEmitter(context: HelmHandlerContext) {
  const socket = context.socketId
    ? context.authenticatedSockets.listAll().find((record: { socketId: string }) => record.socketId === context.socketId)?.socket
    : undefined;
  if (!socket) {
    return (_status: UpdateStatusEvent) => undefined;
  }
  return (status: UpdateStatusEvent) => {
    context.notify(socket, "daemon/update/status", {
      ...status,
      occurredAt: new Date().toISOString(),
    });
  };
}
