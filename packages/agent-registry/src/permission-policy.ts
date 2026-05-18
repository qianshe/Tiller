import type { ApprovalPolicy, ApprovalPolicyRule } from "@tiller/shared";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getDefaultConfigPath, readTillerConfig, type TillerConfig } from "./registry";

const EMPTY_APPROVAL_POLICY: ApprovalPolicy = { rules: [] };

export function readApprovalPolicy(configPath = getDefaultConfigPath()): ApprovalPolicy {
  const policy = readTillerConfig(configPath).approvalPolicy;
  return normalizeApprovalPolicy(policy);
}

export function saveApprovalPolicyRule(
  rule: ApprovalPolicyRule,
  configPath = getDefaultConfigPath(),
): { configPath: string; rule: ApprovalPolicyRule; policy: ApprovalPolicy } {
  const current = readTillerConfig(configPath);
  const currentPolicy = normalizeApprovalPolicy(current.approvalPolicy);
  const nextPolicy: ApprovalPolicy = {
    rules: [
      ...currentPolicy.rules.filter((item) => item.id !== rule.id),
      rule,
    ],
  };
  writeTillerConfig({ ...current, approvalPolicy: nextPolicy }, configPath);
  return { configPath, rule, policy: nextPolicy };
}

function normalizeApprovalPolicy(policy: unknown): ApprovalPolicy {
  if (!policy || typeof policy !== "object" || !Array.isArray((policy as ApprovalPolicy).rules)) {
    return EMPTY_APPROVAL_POLICY;
  }
  return {
    rules: (policy as ApprovalPolicy).rules.filter(isApprovalPolicyRule),
  };
}

function isApprovalPolicyRule(value: unknown): value is ApprovalPolicyRule {
  if (!value || typeof value !== "object") return false;
  const candidate = value as ApprovalPolicyRule;
  return (
    typeof candidate.id === "string" &&
    (candidate.action === "allow" || candidate.action === "deny" || candidate.action === "confirm") &&
    typeof candidate.label === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string"
  );
}

function writeTillerConfig(config: TillerConfig, configPath: string) {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
}
