import { resolveChatCompletionsUrl } from "../../prompt-enhancer/facade";
import type { DeckPreferences } from "../../preferences/storage";

export type GenerateCommitDescriptionInput = {
  selectedPaths: string[];
  projectName?: string;
  sessionTitle?: string;
  llmConfig: DeckPreferences["promptEnhancer"]["llm"];
};

export async function generateCommitDescription(
  input: GenerateCommitDescriptionInput,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const { selectedPaths, projectName, sessionTitle, llmConfig } = input;

  if (!llmConfig || !llmConfig.baseUrl.trim() || !llmConfig.model.trim()) {
    throw new Error("LLM configuration is incomplete");
  }

  const systemPrompt = `你是专业的 Git commit message 生成助手。
基于代码变更生成简洁、准确的 commit message。
遵循 Conventional Commits 规范。

格式: <type>：<description>

类型:
- feat: 新功能
- fix: Bug 修复
- refactor: 重构
- chore: 杂项
- docs: 文档
- test: 测试
- style: 格式

要求:
- 使用中文
- 祈使句语气
- 不超过 50 字
- 描述"做了什么"而非"怎么做"
- 只返回 message 本身，无需解释`;

  const userPrompt = `# 本次变更
${selectedPaths.map((p) => `- ${p}`).join("\n")}

${sessionTitle ? `# 会话标题\n${sessionTitle}\n` : ""}
${projectName ? `# 项目\n${projectName}\n` : ""}

请生成一个 commit message:`;

  const response = await fetcher(resolveChatCompletionsUrl(llmConfig.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(llmConfig.apiKey.trim()
        ? { Authorization: `Bearer ${llmConfig.apiKey.trim()}` }
        : {}),
    },
    body: JSON.stringify({
      model: llmConfig.model.trim(),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 100,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM request failed: ${response.status}`);
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message?.content?.trim();

  if (!message) {
    throw new Error("No message generated from LLM");
  }

  return message;
}
