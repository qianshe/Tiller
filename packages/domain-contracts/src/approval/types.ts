export type ApprovalDecision = "allow_once" | "allow_always" | "deny_once" | "deny_always";

export type ApprovalRuleAction = "allow" | "deny";

export type ApprovalPolicyRule = {
  id: string;
  label: string;
  action: ApprovalRuleAction;
  commandPattern: string;
  createdAt: string;
  updatedAt: string;
};

export type ApprovalRequest = {
  id: string;
  sessionId: string;
  toolCallId: string;
  title: string;
  command?: string;
  createdAt: string;
};

export type ApprovalPolicyResult = {
  matched: boolean;
  action?: ApprovalRuleAction;
  ruleId?: string;
};
