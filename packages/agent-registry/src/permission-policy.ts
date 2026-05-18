import type { ApprovalPolicy, ApprovalPolicyRule } from "@tiller/shared";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
  // 原子写：先写临时文件再 rename，避免中途崩溃损坏 Tiller 全局配置
  // （配置同时承载 helms/agents/projects 等关键状态，比审批策略本身更不能丢）。
  mkdirSync(dirname(configPath), { recursive: true });
  const tmpPath = `${configPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, JSON.stringify(config, null, 2), "utf8");
  try {
    renameSync(tmpPath, configPath);
  } catch (error) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // 清理失败不抑制原错误
    }
    throw error;
  }
}
