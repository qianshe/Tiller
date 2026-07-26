import type {
  PermissionDecision,
  PermissionRequest,
  SessionUpdateRecord,
} from "@tiller/shared";
import type { HelmHandlerContext } from "../handlers/context";
import { resolveApprovalPolicyDecision } from "../handlers/approvals/permission-policy";
import { createSessionEventPublisher } from "./session/event/publisher";
import {
  applyCanonicalSessionStateEvent,
  createCanonicalSessionState,
} from "./session/event/state-reducer";

type HandlePermissionRequestInput = {
  sessionId: string;
  request: PermissionRequest;
  logScope: string;
  sequence?: number;
  update?: SessionUpdateRecord;
};

export function handleRuntimePermissionRequest(
  input: HandlePermissionRequestInput,
  context: HelmHandlerContext,
): void {
  const sessionRecord = context.sessions.get(input.sessionId);
  const autoDecision = resolveAutoApprovalDecision(input, sessionRecord, context);
  if (autoDecision && sessionRecord?.runtime?.supportsPermissionResponses) {
    const liveStateStore = context.sessionLiveStateStore;
    const sequence = input.sequence;
    const update = input.update;
    if (!liveStateStore || sequence === undefined || !update) {
      logCanonicalApprovalFailure(
        context,
        input.sessionId,
        input.request.id,
        [
          !liveStateStore && "live-state",
          sequence === undefined && "sequence",
          !update && "update-record",
        ].filter((item): item is string => Boolean(item)),
      );
      return;
    }
    const current = liveStateStore.get(input.sessionId) ?? createCanonicalSessionState();
    let committed;
    try {
      committed = liveStateStore.commit(
        input.sessionId,
        { type: "pending-approval-count", count: current.status.pendingApprovalCount },
        sequence,
        update,
      );
    } catch (error) {
      logCanonicalApprovalFailure(
        context,
        input.sessionId,
        input.request.id,
        ["atomic-state-commit"],
        error,
      );
      return;
    }
    if (!committed) {
      logCanonicalApprovalFailure(
        context,
        input.sessionId,
        input.request.id,
        ["atomic-state-commit"],
      );
      return;
    }
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
    createSessionEventPublisher(context).sessionUpdate(input.sessionId, {
      kind: "live_state",
      snapshot: committed,
    });
    void Promise.resolve(
      sessionRecord.runtime.respondPermission(input.request.id, autoDecision),
    ).catch((error) => {
      context.logError(
        `[tiller] approval auto-decision response failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    // 自动审批不进入等待态，跳过 waiting_for_permission 写入避免状态闪烁。
    return;
  }

  const approvalRecord = {
    sessionId: input.sessionId,
    request: input.request,
    status: "pending",
  } as const;
  const approvalStateStore = context.sessionApprovalStateStore;
  const liveStateStore = context.sessionLiveStateStore;
  const sequence = input.sequence;
  const update = input.update;
  const missing = [
    !approvalStateStore && "approval-state",
    !liveStateStore && "live-state",
    sequence === undefined && "sequence",
    !update && "update-record",
  ].filter((item): item is string => Boolean(item));
  if (missing.length > 0) {
    logCanonicalApprovalFailure(context, input.sessionId, input.request.id, missing);
    return;
  }
  if (!approvalStateStore || !liveStateStore || sequence === undefined || !update) {
    return;
  }

  const currentApprovals = approvalStateStore.get(input.sessionId);
  const pendingApprovalCount = Object.keys(currentApprovals.active).length + 1;
  const nextSessionState = applyCanonicalSessionStateEvent(
    liveStateStore.get(input.sessionId) ?? createCanonicalSessionState(),
    { type: "pending-approval-count", count: pendingApprovalCount },
    sequence,
  );
  const createdAt = new Date().toISOString();
  const canonicalApproval = {
    id: input.request.id,
    sessionId: input.sessionId,
    runtimeInstanceId:
      sessionRecord?.runtime?.runtimeSessionId ??
      sessionRecord?.summary.runtimeSessionId ??
      input.sessionId,
    toolCallId: input.request.toolCallId,
    sequence,
    status: "pending" as const,
    request: input.request,
    createdAt,
    updatedAt: createdAt,
  };
  try {
    approvalStateStore.commit(
      input.sessionId,
      {
        type: "requested",
        approval: canonicalApproval,
      },
      sequence,
      update,
      nextSessionState,
    );
    liveStateStore.adoptCommitted(input.sessionId, nextSessionState);
  } catch (error) {
    logCanonicalApprovalFailure(
      context,
      input.sessionId,
      input.request.id,
      ["atomic-commit"],
      error,
    );
    return;
  }
  context.approvalIndex.set(input.request.id, approvalRecord);
  context.updateSessionSummary(input.sessionId, (current) => ({
    ...current,
    status: "waiting_for_permission",
    updatedAt: new Date().toISOString(),
    lastMessagePreview: input.request.reason,
  }));
  createSessionEventPublisher(context).sessionUpdate(input.sessionId, {
    kind: "live_state",
    snapshot: nextSessionState,
  });
  context.broadcastNotification("approval/created", {
    sessionId: input.sessionId,
    request: input.request,
    approval: canonicalApproval,
    session: context.sessions.get(input.sessionId)?.summary ?? null,
  });
}

function logCanonicalApprovalFailure(
  context: HelmHandlerContext,
  sessionId: string,
  requestId: string,
  missing: string[],
  error?: unknown,
): void {
  const fields = {
    sessionId,
    requestId,
    missing,
    error: error instanceof Error ? error.message : undefined,
  };
  if (context.logger) {
    context.logger.error("runtime.permission.canonical_state_missing", fields);
    return;
  }
  context.logError(
    `[tiller] runtime.permission.canonical_state_missing sessionId=${sessionId} requestId=${requestId} missing=${missing.join(",")}`,
  );
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
