import type { ErrorResponse } from "./envelope";

export const ErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  Cancelled: -32800,
  Unauthenticated: -32000,
  PairingRequired: -32001,
  PairingCodeExpired: -32002,
  PairingCodeMismatch: -32003,
  DeviceRevoked: -32004,
  HelmNotFound: -32010,
  ProjectNotFound: -32011,
  WorkspaceNotFound: -32012,
  ConfigPersistFailed: -32013,
  GitOperationFailed: -32014,
  ProviderNotFound: -32020,
  ProviderLaunchFailed: -32021,
  ProviderUnauthorized: -32022,
  ProviderTimeout: -32023,
  SessionNotFound: -32030,
  SessionAlreadyEnded: -32031,
  SessionResumeUnsupported: -32032,
  SessionBusy: -32033,
  ImageInputUnsupported: -32034,
  PermissionRequestNotFound: -32040,
  PermissionAlreadyResolved: -32041,
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export function rpcError<D = unknown>(
  code: ErrorCodeValue,
  message: string,
  data?: D,
): ErrorResponse<D> {
  return data === undefined ? { code, message } : { code, message, data };
}

export function isErrorResponse(value: unknown): value is ErrorResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { code?: unknown }).code === "number" &&
    typeof (value as { message?: unknown }).message === "string"
  );
}
