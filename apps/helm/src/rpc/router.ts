import { ErrorCode, rpcError, validateParams, validateResult } from "@tiller/sync-protocol";
import type { HelmHandlerContext } from "../handlers/context";
import { handleApprovalRpcRequest } from "../handlers/approvals/rpc";
import { handleConfigRpcRequest } from "../handlers/config/rpc";
import { handleDeviceRpcRequest } from "../handlers/devices-rpc";
import { handleSessionRpcNotification, handleSessionRpcRequest } from "../handlers/sessions/rpc";
import { handleConversationRpcRequest } from "../handlers/conversations/rpc";
import { handleNotificationRpcRequest } from "../handlers/notifications/rpc";

export async function handleHelmRpcRequest(
  method: string,
  rawParams: unknown,
  context: HelmHandlerContext,
): Promise<unknown> {
  const params = validateParams(method, rawParams);
  const result =
    (await handleApprovalRpcRequest(method, params, context)) ??
    (await handleConfigRpcRequest(method, params, context)) ??
    (await handleDeviceRpcRequest(method, params, context)) ??
    (await handleNotificationRpcRequest(method, params, context)) ??
    (await handleConversationRpcRequest(method, params, context)) ??
    (await handleSessionRpcRequest(method, params, context));
  if (result === undefined) {
    throw rpcError(ErrorCode.MethodNotFound, `Unknown method: ${method}`);
  }
  return validateResult(method, result);
}

export async function handleHelmRpcNotification(
  method: string,
  rawParams: unknown,
  context: HelmHandlerContext,
): Promise<void> {
  const params = validateParams(method, rawParams);
  if (await handleSessionRpcNotification(method, params, context)) {
    return;
  }
  throw rpcError(ErrorCode.MethodNotFound, `Unknown notification: ${method}`);
}
