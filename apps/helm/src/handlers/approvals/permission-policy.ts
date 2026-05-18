import type {
  ApprovalPolicy,
  ApprovalPolicyAction,
  ApprovalPolicyRule,
  PermissionDecision,
  PermissionRequest,
} from "@tiller/shared";

export type ApprovalPolicyContext = {
  providerId?: string;
  projectId?: string;
  worktreePath?: string;
};

export function resolveApprovalPolicyDecision(
  policy: ApprovalPolicy,
  request: PermissionRequest,
  context: ApprovalPolicyContext,
): PermissionDecision | null {
  const matches = policy.rules.filter((rule) => ruleMatches(rule, request, context));
  if (matches.some((rule) => rule.action === "deny")) return "deny";
  if (matches.some((rule) => rule.action === "confirm")) return null;
  if (matches.some((rule) => rule.action === "allow")) return "allow";
  return null;
}

export function buildApprovalPolicyRuleFromDecision(params: {
  decision: PermissionDecision;
  request: PermissionRequest;
  sessionId: string;
  providerId?: string;
  projectId?: string;
  now?: string;
}): ApprovalPolicyRule | null {
  const action = actionFromDecision(params.decision);
  if (!action) return null;

  const now = params.now ?? new Date().toISOString();
  const commandStem = resolveCommandStem(params.request.command);
  const commandPattern = escapeRegex(commandStem);
  const label = `${action === "allow" ? "Allow" : "Deny"} ${commandStem}`;

  return {
    id: `approval-rule:${action}:${params.providerId ?? "any"}:${commandPattern}`,
    action,
    label,
    providerId: params.providerId,
    projectId: params.projectId,
    worktreePath: params.request.cwd,
    commandPattern,
    createdAt: now,
    updatedAt: now,
  };
}

function actionFromDecision(decision: PermissionDecision): ApprovalPolicyAction | null {
  if (decision === "allow_always") return "allow";
  if (decision === "deny_always") return "deny";
  return null;
}

function ruleMatches(
  rule: ApprovalPolicyRule,
  request: PermissionRequest,
  context: ApprovalPolicyContext,
) {
  if (rule.providerId && rule.providerId !== context.providerId) return false;
  if (rule.projectId && rule.projectId !== context.projectId) return false;
  if (rule.worktreePath && normalizePath(rule.worktreePath) !== normalizePath(context.worktreePath ?? request.cwd)) return false;
  if (rule.commandPattern && !safeRegexTest(rule.commandPattern, request.command)) return false;
  if (rule.reasonPattern && !safeRegexTest(rule.reasonPattern, request.reason)) return false;
  return Boolean(rule.commandPattern || rule.reasonPattern);
}

function safeRegexTest(pattern: string, value: string) {
  try {
    return new RegExp(pattern, "iu").test(value);
  } catch {
    return false;
  }
}

function resolveCommandStem(command: string) {
  return command.split("::", 1)[0]?.trim() || command.trim() || "ACP permission request";
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function normalizePath(value: string) {
  return value.replace(/\\/gu, "/").replace(/\/+$/u, "").toLowerCase();
}
