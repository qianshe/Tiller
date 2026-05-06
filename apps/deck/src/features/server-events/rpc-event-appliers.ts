import { handleActivityServerEvent } from "./activity-events";
import { handleDeviceServerEvent } from "./device-events";
import { handleInventoryServerEvent } from "./inventory-events";
import { handleSessionServerEvent } from "./session-events";

type DeviceContext = Parameters<typeof handleDeviceServerEvent>[2];
type InventoryContext = Parameters<typeof handleInventoryServerEvent>[3];
type SessionContext = Parameters<typeof handleSessionServerEvent>[3];
type ActivityContext = Parameters<typeof handleActivityServerEvent>[1];

type SessionUpdateParams = { sessionId: string; update: { kind: string } & Record<string, unknown> };
type ErrorRaisedParams = { sessionId?: string; message: string; code?: string; data?: unknown };

export function applyDeviceResult(
  method: string,
  result: unknown,
  sourceHelmKey: string,
  context: DeviceContext,
): boolean {
  switch (method) {
    case "device/pair":
      return handleDeviceServerEvent({ type: "device.pair.result", requestId: "rpc", ...(result as object) } as any, sourceHelmKey, context);
    case "device/authenticate":
      return handleDeviceServerEvent({ type: "device.auth.result", requestId: "rpc", ...(result as object) } as any, sourceHelmKey, context);
    case "device/list":
      return handleDeviceServerEvent({ type: "device.list.result", requestId: "rpc", ...(result as object) } as any, sourceHelmKey, context);
    case "device/revoke":
      return handleDeviceServerEvent({ type: "device.revoke.result", requestId: "rpc", ...(result as object) } as any, sourceHelmKey, context);
    default:
      return false;
  }
}

export function applyInventoryResult(
  method: string,
  result: unknown,
  sourceHelmKey: string,
  sourceIsCurrentHelm: boolean,
  context: InventoryContext,
): boolean {
  const payload = { requestId: "rpc", ...(result as object) };
  switch (method) {
    case "helm/list":
      return handleInventoryServerEvent({ type: "helm.list.result", ...payload } as any, sourceHelmKey, sourceIsCurrentHelm, context);
    case "project/list":
      return handleInventoryServerEvent({ type: "project.list.result", ...payload } as any, sourceHelmKey, sourceIsCurrentHelm, context);
    case "project/list_files":
      return handleInventoryServerEvent({ type: "project.files.result", ...payload } as any, sourceHelmKey, sourceIsCurrentHelm, context);
    case "workspace/list":
      return handleInventoryServerEvent({ type: "workspace.list.result", ...payload } as any, sourceHelmKey, sourceIsCurrentHelm, context);
    case "workspace/git/list_branches":
    case "workspace/git/create_branch":
      return handleInventoryServerEvent({ type: "workspace.git.result", ...payload } as any, sourceHelmKey, sourceIsCurrentHelm, context);
    case "agent/list":
      return handleInventoryServerEvent({ type: "agent.list.result", ...payload } as any, sourceHelmKey, sourceIsCurrentHelm, context);
    case "agent/test":
      return handleInventoryServerEvent({ type: "agent.test.result", ...payload } as any, sourceHelmKey, sourceIsCurrentHelm, context);
    case "agent/get_model_options":
      return handleInventoryServerEvent({ type: "agent.model.options.result", ...payload } as any, sourceHelmKey, sourceIsCurrentHelm, context);
    case "project/save":
      return handleInventoryServerEvent({ type: "project.save.result", ...payload } as any, sourceHelmKey, sourceIsCurrentHelm, context);
    case "agent/save":
      return handleInventoryServerEvent({ type: "agent.save.result", ...payload } as any, sourceHelmKey, sourceIsCurrentHelm, context);
    default:
      return false;
  }
}

export function applySessionResult(
  method: string,
  result: unknown,
  sourceHelmKey: string,
  sourceIsCurrentHelm: boolean,
  context: SessionContext,
): boolean {
  const payload = { requestId: "rpc", ...(result as object) };
  switch (method) {
    case "session/new":
      return handleSessionServerEvent({ type: "session.created", ...payload } as any, sourceHelmKey, sourceIsCurrentHelm, context);
    case "session/list":
      return handleSessionServerEvent({ type: "session.list.result", ...payload } as any, sourceHelmKey, sourceIsCurrentHelm, context);
    case "session/list_messages":
      return handleSessionServerEvent({ type: "session.messages.list.result", ...payload } as any, sourceHelmKey, sourceIsCurrentHelm, context);
    case "session/get_artifacts":
      return handleSessionServerEvent({ type: "session.artifacts.result", ...payload } as any, sourceHelmKey, sourceIsCurrentHelm, context);
    case "session/check_resume":
      return handleSessionServerEvent({ type: "session.resume.result", ...payload } as any, sourceHelmKey, sourceIsCurrentHelm, context);
    case "session/resume":
      return handleSessionServerEvent({ type: "session.resume.start.result", ...payload } as any, sourceHelmKey, sourceIsCurrentHelm, context);
    case "session/cleanup":
      return handleSessionServerEvent({ type: "session.cleanup.result", ...payload } as any, sourceHelmKey, sourceIsCurrentHelm, context);
    default:
      return false;
  }
}

export function applySessionUpdate(
  params: SessionUpdateParams,
  context: ActivityContext & Partial<SessionContext>,
): boolean {
  const { sessionId, update } = params;
  switch (update.kind) {
    case "agent_message":
      return handleActivityServerEvent({ type: "agent.message", sessionId, message: update.message } as any, context);
    case "permission_request":
      return handleActivityServerEvent({ type: "permission.request", sessionId, permissionRequest: update.permissionRequest } as any, context);
    case "permission_resolved":
      return handleActivityServerEvent({ type: "permission.resolved", sessionId, permissionRequestId: update.permissionRequestId, decision: update.decision } as any, context);
    case "command_output":
      return handleActivityServerEvent({ type: "command.output", sessionId, commandId: update.commandId, chunk: update.chunk } as any, context);
    case "tool_call":
      return handleActivityServerEvent({ type: "tool.call", sessionId, toolCall: update.toolCall } as any, context);
    case "diff_update":
      return handleActivityServerEvent({ type: "diff.update", sessionId, files: update.files } as any, context);
    case "status_change":
      return Boolean(context && handleSessionServerEvent({ type: "session.status", sessionId, status: update.status, message: update.message } as any, "", true, context as SessionContext));
    case "config_options":
      return Boolean(context && handleSessionServerEvent({ type: "session.config.options", sessionId, state: update.state, options: update.options } as any, "", true, context as SessionContext));
    case "model_options":
      return Boolean(context && handleSessionServerEvent({ type: "session.model.options", sessionId, currentModelId: update.currentModelId, options: update.options } as any, "", true, context as SessionContext));
    case "commands_available":
      return Boolean(context && handleSessionServerEvent({ type: "session.commands", sessionId, commands: update.commands } as any, "", true, context as SessionContext));
    case "session_updated":
      return Boolean(context && handleSessionServerEvent({ type: "session.updated", sessionId, session: update.session } as any, "", true, context as SessionContext));
    default:
      return false;
  }
}

export function applyErrorRaised(params: ErrorRaisedParams, context: ActivityContext): boolean {
  return handleActivityServerEvent({ type: "error", ...params } as any, context);
}
