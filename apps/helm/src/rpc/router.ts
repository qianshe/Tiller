import { ErrorCode, rpcError, validateParams, validateResult } from "@tiller/sync-protocol";
import type { HelmHandlerContext } from "../handlers/context";
import { handleConfigRpcRequest } from "../handlers/config/rpc";

export async function handleHelmRpcRequest(
  method: string,
  rawParams: unknown,
  context: HelmHandlerContext,
): Promise<unknown> {
  const params = validateParams(method, rawParams);
  const result = await handleConfigRpcRequest(method, params, context);
  if (result === undefined) {
    throw rpcError(ErrorCode.MethodNotFound, `Unknown method: ${method}`);
  }
  return validateResult(method, result);
}

export async function handleHelmRpcNotification(
  method: string,
  rawParams: unknown,
  _context: HelmHandlerContext,
): Promise<void> {
  validateParams(method, rawParams);
  throw rpcError(ErrorCode.MethodNotFound, `Unknown notification: ${method}`);
}
