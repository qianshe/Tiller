import assert from "node:assert/strict";
import test from "node:test";
import type { ApprovalPolicy, PermissionRequest } from "@tiller/shared";
import {
  buildApprovalPolicyRuleFromDecision,
  resolveApprovalPolicyDecision,
} from "./permission-policy.js";

const request: PermissionRequest = {
  id: "approval-1",
  command: "MCP • sanshu/zhi :: {\"project_root_path\":\"D:/repo\"}",
  reason: "Approve MCP tool call",
  cwd: "D:/repo",
  options: [
    { decision: "allow", label: "本次允许" },
    { decision: "allow_always", label: "全局允许" },
    { decision: "deny", label: "拒绝" },
  ],
};

const context = {
  providerId: "codex",
  projectId: "tiller",
  worktreePath: "D:/repo",
};

test("approval policy returns allow for matching allow rule", () => {
  const policy: ApprovalPolicy = {
    rules: [
      {
        id: "rule-1",
        action: "allow",
        label: "Allow sanshu",
        providerId: "codex",
        commandPattern: "^MCP • sanshu/",
        createdAt: "2026-05-16T00:00:00.000Z",
        updatedAt: "2026-05-16T00:00:00.000Z",
      },
    ],
  };

  assert.equal(resolveApprovalPolicyDecision(policy, request, context), "allow");
});

test("approval policy prefers deny over allow", () => {
  const policy: ApprovalPolicy = {
    rules: [
      {
        id: "allow-rule",
        action: "allow",
        label: "Allow MCP",
        commandPattern: "^MCP",
        createdAt: "2026-05-16T00:00:00.000Z",
        updatedAt: "2026-05-16T00:00:00.000Z",
      },
      {
        id: "deny-rule",
        action: "deny",
        label: "Deny sanshu",
        commandPattern: "sanshu/zhi",
        createdAt: "2026-05-16T00:00:00.000Z",
        updatedAt: "2026-05-16T00:00:00.000Z",
      },
    ],
  };

  assert.equal(resolveApprovalPolicyDecision(policy, request, context), "deny");
});

test("approval policy ignores invalid regex rules", () => {
  const policy: ApprovalPolicy = {
    rules: [
      {
        id: "broken-rule",
        action: "allow",
        label: "Broken",
        commandPattern: "(",
        createdAt: "2026-05-16T00:00:00.000Z",
        updatedAt: "2026-05-16T00:00:00.000Z",
      },
    ],
  };

  assert.equal(resolveApprovalPolicyDecision(policy, request, context), null);
});

test("buildApprovalPolicyRuleFromDecision creates allow rule from allow_always", () => {
  const rule = buildApprovalPolicyRuleFromDecision({
    decision: "allow_always",
    request,
    sessionId: "session-1",
    providerId: "codex",
    projectId: "tiller",
    now: "2026-05-16T00:00:00.000Z",
  });

  assert.equal(rule?.action, "allow");
  assert.equal(rule?.providerId, "codex");
  assert.equal(rule?.projectId, "tiller");
  assert.match(rule?.commandPattern ?? "", /MCP/);
});

test("buildApprovalPolicyRuleFromDecision creates deny rule from deny_always", () => {
  const rule = buildApprovalPolicyRuleFromDecision({
    decision: "deny_always",
    request,
    sessionId: "session-1",
    providerId: "codex",
    projectId: "tiller",
    now: "2026-05-16T00:00:00.000Z",
  });

  assert.equal(rule?.action, "deny");
});

test("buildApprovalPolicyRuleFromDecision ignores once and session decisions", () => {
  assert.equal(
    buildApprovalPolicyRuleFromDecision({
      decision: "allow",
      request,
      sessionId: "session-1",
      now: "2026-05-16T00:00:00.000Z",
    }),
    null,
  );
  assert.equal(
    buildApprovalPolicyRuleFromDecision({
      decision: "allow_session",
      request,
      sessionId: "session-1",
      now: "2026-05-16T00:00:00.000Z",
    }),
    null,
  );
});
