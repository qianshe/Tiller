import assert from "node:assert/strict";
import test from "node:test";
import type { ApprovalPolicyRule } from "@tiller/domain-contracts";
import { evaluateApprovalPolicy } from "./policy";

const allowRule: ApprovalPolicyRule = {
  id: "allow-read",
  label: "Allow read",
  action: "allow",
  commandPattern: "^read",
  createdAt: "2026-05-24T00:00:00.000Z",
  updatedAt: "2026-05-24T00:00:00.000Z",
};

const denyRule: ApprovalPolicyRule = {
  id: "deny-secret",
  label: "Deny secrets",
  action: "deny",
  commandPattern: "secret",
  createdAt: "2026-05-24T00:00:00.000Z",
  updatedAt: "2026-05-24T00:00:00.000Z",
};

test("approval policy returns no match for empty command", () => {
  assert.deepEqual(evaluateApprovalPolicy(undefined, [allowRule]), { matched: false });
});

test("approval policy matches allow rules", () => {
  assert.deepEqual(evaluateApprovalPolicy("read file", [allowRule]), {
    matched: true,
    action: "allow",
    ruleId: "allow-read",
  });
});

test("approval policy prefers deny over allow", () => {
  assert.deepEqual(evaluateApprovalPolicy("read secret file", [allowRule, denyRule]), {
    matched: true,
    action: "deny",
    ruleId: "deny-secret",
  });
});

test("approval policy ignores invalid regex rules", () => {
  assert.deepEqual(
    evaluateApprovalPolicy("read file", [
      { ...denyRule, id: "bad", commandPattern: "[" },
      allowRule,
    ]),
    { matched: true, action: "allow", ruleId: "allow-read" },
  );
});
