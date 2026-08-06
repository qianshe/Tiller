import type { CanonicalApproval, PermissionDecision } from "@tiller/shared";
import { buildApprovalPolicyRuleFromDecision } from "./permission-policy";
import { broadcastSessionUpdate } from "../../rpc/notifications";
import {
  prepareRuntimeSessionUpdate,
} from "../../runtime/events";
import {
  applyCanonicalSessionStateEvent,
  createCanonicalSessionState,
} from "../../runtime/session/event/state-reducer";
import type { HelmHandlerContext } from "../context";

export async function handleApprovalRpcRequest(
  method: string,
  params: unknown,
  context: HelmHandlerContext,
): Promise<unknown | undefined> {
  switch (method) {
    case "approval/list_pending":
      return listPendingApprovals(context);
    case "approval/list":
      return listApprovalHistory(
        params as { limit?: number; before?: string },
        context,
      );
    case "approval/clear_history":
      return clearApprovalHistory(context);
    case "approval/respond":
      return respondApproval(
        params as { approvalRequestId: string; decision: PermissionDecision },
        context,
      );
    // Compatibility shims: route legacy permission/* through the same approval
    // inventory. Remove once Deck callers fully switch to approval/* and the
    // sync-protocol descriptors retire `permission/*`.
    case "permission/list_pending":
      return listPendingPermissionsCompat(context);
    case "permission/respond":
      return respondPermissionCompat(
        params as { permissionRequestId: string; decision: PermissionDecision },
        context,
      );
    default:
      return undefined;
  }
}

export function listPendingApprovals(context: HelmHandlerContext) {
  return {
    approvals: listCanonicalPendingApprovals(context).map((approval) => ({
      sessionId: approval.sessionId,
      request: approval.request,
      status: approval.status,
      createdAt: approval.createdAt ?? approval.updatedAt,
    })),
  };
}

export function listApprovalHistory(
  params: { limit?: number; before?: string },
  context: HelmHandlerContext,
) {
  return context.sessionApprovalStateStore?.listHistory({
    limit: params.limit,
    before: params.before,
  }) ?? { approvals: [], hasMore: false };
}

export function clearApprovalHistory(context: HelmHandlerContext) {
  const removed = context.sessionApprovalStateStore?.clearProcessedHistory() ?? 0;
  const history = context.sessionApprovalStateStore?.listHistory({ limit: 100 })
    ?? { approvals: [], hasMore: false };
  return {
    ok: true,
    removed,
    ...history,
  };
}

export function listPendingPermissionsCompat(context: HelmHandlerContext) {
  return {
    permissions: listCanonicalPendingApprovals(context).map((approval) => ({
      sessionId: approval.sessionId,
      request: approval.request,
    })),
  };
}

export async function respondApproval(
  params: { approvalRequestId: string; decision: PermissionDecision },
  context: HelmHandlerContext,
) {
  const approval = findCanonicalPendingApproval(params.approvalRequestId, context);
  if (!approval) {
    throw new Error(`Approval request ${params.approvalRequestId} already resolved or not found.`);
  }
  if (approval.status === "resolving") {
    throw new Error(`Approval request ${params.approvalRequestId} is already resolving.`);
  }
  const record = context.sessions.get(approval.sessionId);
  if (!record) {
    throw new Error("Session not found for approval response");
  }
  if (!record.runtime.supportsPermissionResponses) {
    const error = new Error(
      "Real ACP permission passthrough is not wired yet. The request is still pending.",
    );
    (error as Error & { code?: string }).code = "ACP_PERMISSION_UNSUPPORTED";
    throw error;
  }

  const { sessionApprovalStateStore, sessionLiveStateStore } = requireCanonicalApprovalStores(context);
  {
    const updatedAt = new Date().toISOString();
    const event = {
      type: "approval-status" as const,
      approvalId: params.approvalRequestId,
      status: "resolving" as const,
      updatedAt,
    };
    const prepared = prepareRuntimeSessionUpdate(approval.sessionId, event, context);
    const currentSessionState = sessionLiveStateStore.get(approval.sessionId) ??
      createCanonicalSessionState();
    const nextSessionState = applyCanonicalSessionStateEvent(
      currentSessionState,
      {
        type: "pending-approval-count",
        count: currentSessionState.status.pendingApprovalCount,
      },
      prepared.resolvedSequence,
    );
    sessionApprovalStateStore.commit(
      approval.sessionId,
      {
        type: "status-changed",
        approvalId: params.approvalRequestId,
        status: "resolving",
        updatedAt,
      },
      prepared.resolvedSequence,
      prepared.update,
      nextSessionState,
    );
    sessionLiveStateStore.adoptCommitted(approval.sessionId, nextSessionState);
  }
  context.approvalIndex.set(params.approvalRequestId, {
    ...approval,
    status: "resolving",
  });

  try {
    await record.runtime.respondPermission(params.approvalRequestId, params.decision);
  } catch (error) {
    const updatedAt = new Date().toISOString();
    const event = {
      type: "approval-status" as const,
      approvalId: params.approvalRequestId,
      status: "pending" as const,
      updatedAt,
    };
    const prepared = prepareRuntimeSessionUpdate(approval.sessionId, event, context);
    const currentSessionState = sessionLiveStateStore.get(approval.sessionId) ??
      createCanonicalSessionState();
    const nextSessionState = applyCanonicalSessionStateEvent(
      currentSessionState,
      {
        type: "pending-approval-count",
        count: currentSessionState.status.pendingApprovalCount,
      },
      prepared.resolvedSequence,
    );
    sessionApprovalStateStore.commit(
      approval.sessionId,
      {
        type: "status-changed",
        approvalId: params.approvalRequestId,
        status: "pending",
        updatedAt,
      },
      prepared.resolvedSequence,
      prepared.update,
      nextSessionState,
    );
    sessionLiveStateStore.adoptCommitted(approval.sessionId, nextSessionState);
    context.approvalIndex.set(params.approvalRequestId, {
      ...approval,
      status: "pending",
    });
    throw error;
  }

  const responseEvent = {
    type: "permission-response" as const,
    requestId: params.approvalRequestId,
    decision: params.decision,
  };
  const prepared = prepareRuntimeSessionUpdate(approval.sessionId, responseEvent, context);
  const remainingApprovalCount = Object.keys(
    sessionApprovalStateStore.get(approval.sessionId).active,
  ).filter((approvalId) => approvalId !== params.approvalRequestId).length;
  const canonicalSnapshot = applyCanonicalSessionStateEvent(
    sessionLiveStateStore.get(approval.sessionId) ?? createCanonicalSessionState(),
    { type: "pending-approval-count", count: remainingApprovalCount },
    prepared.resolvedSequence,
  );
  const resolvedAt = new Date().toISOString();
  const resolvedApproval: CanonicalApproval = {
    ...approval,
    status: "resolved",
    decision: params.decision,
    createdAt: approval.createdAt ?? approval.updatedAt,
    updatedAt: resolvedAt,
  };
  sessionApprovalStateStore.commit(
    approval.sessionId,
    {
      type: "resolved",
      approvalId: params.approvalRequestId,
      decision: params.decision,
      updatedAt: resolvedAt,
    },
    prepared.resolvedSequence,
    prepared.update,
    canonicalSnapshot,
  );
  sessionLiveStateStore.adoptCommitted(approval.sessionId, canonicalSnapshot);

  const policyRule = buildApprovalPolicyRuleFromDecision({
    decision: params.decision,
    request: approval.request,
    providerId: record.summary?.agentId,
    projectId: record.summary?.projectId,
  });
  if (policyRule) {
    try {
      context.saveApprovalPolicyRule(policyRule);
    } catch (error) {
      context.logWarn(
        `[tiller] approval policy save failed; continuing one-time response: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  context.approvalIndex.delete(params.approvalRequestId);
  context.permissionIndex.delete(params.approvalRequestId);

  context.updateSessionSummary(approval.sessionId, (current) => ({
    ...current,
    status: canonicalSnapshot?.status.effectiveStatus ?? "running",
    updatedAt: new Date().toISOString(),
  }));

  context.broadcastNotification("approval/resolved", {
    sessionId: approval.sessionId,
    approvalRequestId: params.approvalRequestId,
    decision: params.decision,
    approval: resolvedApproval,
  });
  broadcastSessionUpdate(context, approval.sessionId, {
    kind: "live_state",
    snapshot: canonicalSnapshot,
  });

  return {
    ok: true,
    approvalRequestId: params.approvalRequestId,
    decision: params.decision,
  };
}

type CanonicalPendingApproval = CanonicalApproval & {
  status: "pending" | "resolving";
};

function requireCanonicalApprovalStores(context: HelmHandlerContext) {
  if (!context.sessionApprovalStateStore || !context.sessionLiveStateStore) {
    throw new Error("Canonical approval state services are required.");
  }
  return {
    sessionApprovalStateStore: context.sessionApprovalStateStore,
    sessionLiveStateStore: context.sessionLiveStateStore,
  };
}

function listCanonicalPendingApprovals(
  context: HelmHandlerContext,
): CanonicalPendingApproval[] {
  if (!context.sessionApprovalStateStore) {
    return [];
  }
  const sessionIds = new Set<string>([
    ...context.sessions.keys(),
    ...context.sessionStore.list().map((session: { id: string }) => session.id),
  ]);
  return Array.from(sessionIds).flatMap((sessionId) =>
    Object.values(context.sessionApprovalStateStore!.get(sessionId).active)
      .filter((approval): approval is CanonicalPendingApproval =>
        approval.status === "pending" || approval.status === "resolving",
      ),
  );
}

function findCanonicalPendingApproval(
  approvalRequestId: string,
  context: HelmHandlerContext,
): CanonicalPendingApproval | undefined {
  return listCanonicalPendingApprovals(context)
    .find((approval) => approval.id === approvalRequestId);
}

export async function respondPermissionCompat(
  params: { permissionRequestId: string; decision: PermissionDecision },
  context: HelmHandlerContext,
) {
  const result = await respondApproval(
    {
      approvalRequestId: params.permissionRequestId,
      decision: params.decision,
    },
    context,
  );

  return {
    ok: result.ok,
    permissionRequestId: result.approvalRequestId,
    decision: result.decision,
  };
}
