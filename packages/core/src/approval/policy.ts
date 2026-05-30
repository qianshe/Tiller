import type { ApprovalPolicyResult, ApprovalPolicyRule } from "@tiller/domain-contracts";

export function evaluateApprovalPolicy(command: string | undefined, rules: ApprovalPolicyRule[]): ApprovalPolicyResult {
  if (!command) {
    return { matched: false };
  }

  let allowMatch: ApprovalPolicyResult | null = null;
  for (const rule of rules) {
    if (!matchesCommand(command, rule.commandPattern)) {
      continue;
    }
    if (rule.action === "deny") {
      return { matched: true, action: "deny", ruleId: rule.id };
    }
    allowMatch = { matched: true, action: "allow", ruleId: rule.id };
  }

  return allowMatch ?? { matched: false };
}

function matchesCommand(command: string, pattern: string): boolean {
  try {
    return new RegExp(pattern).test(command);
  } catch {
    return false;
  }
}
