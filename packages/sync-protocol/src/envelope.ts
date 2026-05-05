export type JsonRpcId = string | number;

export type JsonRpcRequest<M extends string = string, P = unknown> = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: M;
  params?: P;
};

export type JsonRpcNotification<M extends string = string, P = unknown> = {
  jsonrpc: "2.0";
  method: M;
  params?: P;
};

export type JsonRpcSuccess<R = unknown> = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: R;
};

export type ErrorResponse<D = unknown> = {
  code: number;
  message: string;
  data?: D;
};

export type JsonRpcFailure<D = unknown> = {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  error: ErrorResponse<D>;
};

export type JsonRpcResponse<R = unknown, D = unknown> =
  | JsonRpcSuccess<R>
  | JsonRpcFailure<D>;

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcResponse;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!isRecord(value)) return false;
  return (
    value.jsonrpc === "2.0" &&
    (typeof value.id === "string" || typeof value.id === "number") &&
    typeof value.method === "string"
  );
}

export function isJsonRpcNotification(value: unknown): value is JsonRpcNotification {
  if (!isRecord(value)) return false;
  return value.jsonrpc === "2.0" && !("id" in value) && typeof value.method === "string";
}

export function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  if (!isRecord(value)) return false;
  const idOk =
    value.id === null || typeof value.id === "string" || typeof value.id === "number";
  return value.jsonrpc === "2.0" && idOk && ("result" in value || "error" in value);
}
