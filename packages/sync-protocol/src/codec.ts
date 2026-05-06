import { z } from "zod";
import type { JsonRpcMessage } from "./envelope";
import { ErrorCode, rpcError } from "./errors";
import { METHODS } from "./methods";

const IdSchema = z.union([z.string(), z.number()]);
const ErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown().optional(),
});

const MessageSchema = z.union([
  z.object({
    jsonrpc: z.literal("2.0"),
    id: IdSchema,
    method: z.string(),
    params: z.unknown().optional(),
  }),
  z.object({
    jsonrpc: z.literal("2.0"),
    method: z.string(),
    params: z.unknown().optional(),
  }),
  z.object({
    jsonrpc: z.literal("2.0"),
    id: z.union([IdSchema, z.null()]),
    result: z.unknown(),
  }),
  z.object({
    jsonrpc: z.literal("2.0"),
    id: z.union([IdSchema, z.null()]),
    error: ErrorSchema,
  }),
]);

export function decodeMessage(raw: string): JsonRpcMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw rpcError(ErrorCode.ParseError, "Parse error");
  }
  if (Array.isArray(parsed)) {
    throw rpcError(ErrorCode.InvalidRequest, "Batch requests are not supported");
  }
  const result = MessageSchema.safeParse(parsed);
  if (!result.success) {
    throw rpcError(ErrorCode.InvalidRequest, "Invalid JSON-RPC envelope", result.error.issues);
  }
  return result.data as JsonRpcMessage;
}

export function validateParams(method: string, params: unknown): unknown {
  const descriptor = METHODS[method];
  if (!descriptor) {
    throw rpcError(ErrorCode.MethodNotFound, `Unknown method: ${method}`);
  }
  const result = descriptor.paramsSchema.safeParse(params ?? {});
  if (!result.success) {
    throw rpcError(ErrorCode.InvalidParams, "Invalid params", result.error.issues);
  }
  return result.data;
}

export function validateResult(method: string, result: unknown): unknown {
  const descriptor = METHODS[method];
  if (!descriptor) {
    throw rpcError(ErrorCode.MethodNotFound, `Unknown method: ${method}`);
  }
  if (descriptor.kind !== "request") {
    throw rpcError(ErrorCode.InvalidRequest, `Method has no result: ${method}`);
  }
  const parsed = descriptor.resultSchema.safeParse(result);
  if (!parsed.success) {
    throw rpcError(ErrorCode.InternalError, "Invalid result", parsed.error.issues);
  }
  return parsed.data;
}

export function encodeMessage(message: JsonRpcMessage): string {
  return JSON.stringify(message);
}
