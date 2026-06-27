import type { PermissionDecision, PermissionRequest } from "@tiller/shared";
import type { HelmHandlerContext } from "../handlers/context";
import { resolveApprovalPolicyDecision } from "../handlers/approvals/permission-policy";

type HandlePermissionRequestInput = {
  sessionId: string;
  request: PermissionRequest;
  logScope: string;
};

export function handleRuntimePermissionRequest(
  input: HandlePermissionRequestInput,
  context: HelmHandlerContext,
): void {
  const sessionRecord = context.sessions.get(input.sessionId);
  const autoDecision = resolveAutoApprovalDecision(input, sessionRecord, context);
  if (autoDecision && sessionRecord?.runtime?.supportsPermissionResponses) {
    const fields = {
      sessionId: input.sessionId,
      requestId: input.request.id,
      decision: autoDecision,
      scope: input.logScope,
    };
    if (context.logger) {
      context.logger.info("runtime.permission.auto_decided", fields);
    } else {
      context.logInfo(
        `[tiller] runtime.permission.auto_decided sessionId=${fields.sessionId} requestId=${fields.requestId} decision=${fields.decision} scope=${fields.scope}`,
      );
    }
    sessionRecord.runtime.respondPermission(input.request.id, autoDecision);
    // 自动审批不进入等待态，跳过 waiting_for_permission 写入避免状态闪烁。
    return;
  }

  context.updateSessionSummary(input.sessionId, (current) => ({
    ...current,
    status: "waiting_for_permission",
    updatedAt: new Date().toISOString(),
    lastMessagePreview: input.request.reason,
  }));
  context.approvalIndex.set(input.request.id, {
    sessionId: input.sessionId,
    request: input.request,
  });
  context.broadcastNotification("approval/created", {
    sessionId: input.sessionId,
    request: input.request,
    session: context.sessions.get(input.sessionId)?.summary ?? null,
  });
}

function resolveAutoApprovalDecision(
  input: HandlePermissionRequestInput,
  sessionRecord: ReturnType<HelmHandlerContext["sessions"]["get"]>,
  context: HelmHandlerContext,
): PermissionDecision | null {
  try {
    return resolveApprovalPolicyDecision(
      context.readApprovalPolicy(),
      input.request,
      {
        providerId: sessionRecord?.summary?.agentId,
        projectId: sessionRecord?.summary?.projectId,
        worktreePath: input.request.cwd,
      },
    );
  } catch (error) {
    context.logWarn(
      `[tiller] approval policy read failed; falling back to manual approval: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
