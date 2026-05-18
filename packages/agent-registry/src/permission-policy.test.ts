import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readApprovalPolicy, saveApprovalPolicyRule } from "./permission-policy.js";

function createConfigPath() {
  return join(mkdtempSync(join(tmpdir(), "tiller-approval-policy-")), "config.json");
}

test("saveApprovalPolicyRule persists and replaces rules by id", () => {
  const configPath = createConfigPath();
  const firstRule = {
    id: "rule-1",
    action: "allow" as const,
    label: "Allow MCP",
    commandPattern: "^MCP",
    createdAt: "2026-05-16T00:00:00.000Z",
    updatedAt: "2026-05-16T00:00:00.000Z",
  };
  const updatedRule = {
    ...firstRule,
    action: "deny" as const,
    label: "Deny MCP",
    updatedAt: "2026-05-16T00:01:00.000Z",
  };

  saveApprovalPolicyRule(firstRule, configPath);
  saveApprovalPolicyRule(updatedRule, configPath);

  assert.deepEqual(readApprovalPolicy(configPath).rules, [updatedRule]);
});

test("readApprovalPolicy ignores invalid persisted policy shapes", () => {
  const configPath = createConfigPath();
  writeFileSync(configPath, JSON.stringify({ approvalPolicy: { rules: [{ id: "broken" }] } }), "utf8");

  assert.deepEqual(readApprovalPolicy(configPath), { rules: [] });
});
