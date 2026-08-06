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

test("approval policy exposes matching confirm rules", () => {
  const policy: ApprovalPolicy = {
    rules: [
      {
        id: "confirm-rule",
        action: "confirm",
        label: "Confirm MCP",
        commandPattern: "^MCP",
        createdAt: "2026-05-16T00:00:00.000Z",
        updatedAt: "2026-05-16T00:00:00.000Z",
      },
    ],
  };

  assert.equal(resolveApprovalPolicyDecision(policy, request, context), "confirm");
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
    providerId: "codex",
    projectId: "tiller",
    now: "2026-05-16T00:00:00.000Z",
  });

  assert.equal(rule?.action, "allow");
  assert.equal(rule?.providerId, "codex");
  // allow_always 是全局作用域，不应绑死到当前 project / worktree
  assert.equal(rule?.projectId, undefined);
  assert.equal(rule?.worktreePath, undefined);
  assert.match(rule?.commandPattern ?? "", /MCP/);
});

test("buildApprovalPolicyRuleFromDecision creates deny rule from deny_always", () => {
  const rule = buildApprovalPolicyRuleFromDecision({
    decision: "deny_always",
    request,
    providerId: "codex",
    projectId: "tiller",
    now: "2026-05-16T00:00:00.000Z",
  });

  assert.equal(rule?.action, "deny");
});

test("allow_always rules apply across different projects and worktrees", () => {
  const rule = buildApprovalPolicyRuleFromDecision({
    decision: "allow_always",
    request,
    providerId: "codex",
    projectId: "tiller",
    now: "2026-05-16T00:00:00.000Z",
  });
  assert.ok(rule);
  // 规则不应该被钉死在生成时的 project / worktree 上
  assert.equal(rule!.projectId, undefined);
  assert.equal(rule!.worktreePath, undefined);

  const policy: ApprovalPolicy = { rules: [rule!] };
  assert.equal(
    resolveApprovalPolicyDecision(policy, request, {
      providerId: "codex",
      projectId: "another-project",
      worktreePath: "D:/elsewhere",
    }),
    "allow",
  );
});

test("buildApprovalPolicyRuleFromDecision keeps id stable across projects", () => {
  const ruleA = buildApprovalPolicyRuleFromDecision({
    decision: "allow_always",
    request,
    providerId: "codex",
    projectId: "tiller",
    now: "2026-05-16T00:00:00.000Z",
  });
  const ruleB = buildApprovalPolicyRuleFromDecision({
    decision: "allow_always",
    request,
    providerId: "codex",
    projectId: "another-project",
    now: "2026-05-16T00:01:00.000Z",
  });
  // 同一 provider + command 在不同 project 选"全局允许"应该指向同一条规则，
  // 后写入的只是刷新 updatedAt，而不是把前一条悄悄替换成另一个 project 专属。
  assert.equal(ruleA!.id, ruleB!.id);
});

test("buildApprovalPolicyRuleFromDecision ignores once and session decisions", () => {
  assert.equal(
    buildApprovalPolicyRuleFromDecision({
      decision: "allow",
      request,
      now: "2026-05-16T00:00:00.000Z",
    }),
    null,
  );
  assert.equal(
    buildApprovalPolicyRuleFromDecision({
      decision: "allow_session",
      request,
      now: "2026-05-16T00:00:00.000Z",
    }),
    null,
  );
});
