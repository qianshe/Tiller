import type { HelmHandlerContext } from "./context";

export async function handleDeviceRpcRequest(
  method: string,
  params: unknown,
  context: HelmHandlerContext,
): Promise<unknown | undefined> {
  switch (method) {
    case "device/list":
      return {
        devices: context.trustedDeviceStore.list().map(context.toTrustedDeviceSummary),
      };
    case "device/revoke":
      return revokeDevice(params as { deviceId: string }, context);
    case "device/authenticate":
    case "device/pair":
      return undefined;
    default:
      return undefined;
  }
}

function revokeDevice(
  params: { deviceId: string },
  context: HelmHandlerContext,
): { ok: boolean; deviceId: string; message: string } {
  const revoked = context.trustedDeviceStore.revoke(params.deviceId);
  const revokedSockets = context.authenticatedSockets.listForDevice(params.deviceId);
  for (const record of revokedSockets) {
    context.authenticatedSockets.remove(record.socketId);
    record.socket.close();
  }
  return {
    ok: revoked,
    deviceId: params.deviceId,
    message: revoked ? "Beacon revoked." : "Beacon not found.",
  };
}
