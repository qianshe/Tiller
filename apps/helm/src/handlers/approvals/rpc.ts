import type { PermissionDecision } from "@tiller/shared";
import { buildApprovalPolicyRuleFromDecision } from "./permission-policy";
import { broadcastSessionUpdate } from "../../rpc/notifications";
import type { HelmHandlerContext } from "../context";

export async function handleApprovalRpcRequest(
  method: string,
  params: unknown,
  context: HelmHandlerContext,
): Promise<unknown | undefined> {
  switch (method) {
    case "approval/list_pending":
      return listPendingApprovals(context);
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
    approvals: Array.from(context.approvalIndex.values()).map((approval) => ({
      sessionId: approval.sessionId,
      request: approval.request,
    })),
  };
}

export function listPendingPermissionsCompat(context: HelmHandlerContext) {
  return {
    permissions: Array.from(context.approvalIndex.values()).map((approval) => ({
      sessionId: approval.sessionId,
      request: approval.request,
    })),
  };
}

export function respondApproval(
  params: { approvalRequestId: string; decision: PermissionDecision },
  context: HelmHandlerContext,
) {
  const approval = context.approvalIndex.get(params.approvalRequestId);
  if (!approval) {
    throw new Error(`Approval request ${params.approvalRequestId} already resolved or not found.`);
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

  const updated = context.updateSessionSummary(approval.sessionId, (current) => ({
    ...current,
    status: "running",
    updatedAt: new Date().toISOString(),
  }));

  context.broadcastNotification("approval/resolved", {
    sessionId: approval.sessionId,
    approvalRequestId: params.approvalRequestId,
    decision: params.decision,
  });
  broadcastSessionUpdate(context, approval.sessionId, {
    kind: "status_change",
    status: "running",
    message: "Approval response sent",
  });
  if (updated) {
    broadcastSessionUpdate(context, approval.sessionId, {
      kind: "session_updated",
      session: context.hydrateSessionSummary(updated),
    });
  }

  record.runtime.respondPermission(params.approvalRequestId, params.decision);
  return {
    ok: true,
    approvalRequestId: params.approvalRequestId,
    decision: params.decision,
  };
}

export function respondPermissionCompat(
  params: { permissionRequestId: string; decision: PermissionDecision },
  context: HelmHandlerContext,
) {
  const result = respondApproval(
    {
      approvalRequestId: params.permissionRequestId,
      decision: params.decision,
    },
    context,
  ) as {
    ok: boolean;
    approvalRequestId: string;
    decision: PermissionDecision;
  };

  return {
    ok: result.ok,
    permissionRequestId: result.approvalRequestId,
    decision: result.decision,
  };
}
