export type AgentTemplate = {
  id: string;
  name: string;
  command: string;
  args: string[];
  installHint: string;
};

export type AgentTemplateDraft = { name: string; command: string; args: string[] };

/**
 * 常用 ACP agent 模板：点击即预填表单的 name/command/args，
 * installHint 仅作前端展示，不随 provider 持久化。
 */
export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: "codex",
    name: "Codex CLI",
    command: "codex-acp",
    args: [],
    installHint:
      "npm install -g @agentclientprotocol/codex-acp；需要 OpenAI 账号（CODEX_API_KEY / OPENAI_API_KEY 或 ChatGPT 订阅）",
  },
  {
    id: "claude-code",
    name: "Claude Code",
    command: "claude-agent-acp",
    args: [],
    installHint:
      "npm install -g @agentclientprotocol/claude-agent-acp；需要 ANTHROPIC_API_KEY 或已登录的 Claude 账号",
  },
  {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
    args: ["acp"],
    installHint:
      "npm install -g opencode-ai（或 curl -fsSL https://opencode.ai/install | bash）；需要配置模型 provider（如 OPENCODE_API_KEY）",
  },
];

export function applyAgentTemplate(template: AgentTemplate): AgentTemplateDraft {
  return {
    name: template.name,
    command: template.command,
    args: [...template.args],
  };
}

export function findMatchingTemplate(
  draft: Pick<AgentTemplateDraft, "command">,
): AgentTemplate | undefined {
  const command = draft.command.trim();
  if (!command) {
    return undefined;
  }
  return AGENT_TEMPLATES.find((template) => template.command === command);
}
