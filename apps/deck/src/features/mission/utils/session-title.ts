import type { PromptEnhancerPreferences } from "../../prompt-enhancer";

type SessionTitleGenerator = (
  prompt: string,
  llm: PromptEnhancerPreferences["llm"],
) => Promise<string>;

export function createFallbackSessionTitle(prompt: string) {
  return prompt.replace(/[\p{P}\p{S}\s]+/gu, "").slice(0, 5) || "新任务";
}

export function normalizeGeneratedSessionTitle(value: string) {
  return value.replace(/["'""''`#：:，,。.!！?？\s]+/gu, "").slice(0, 8);
}

export async function resolveRegeneratedSessionTitle(
  prompt: string,
  llm: PromptEnhancerPreferences["llm"],
  generator: SessionTitleGenerator = generateSessionTitleWithLlm,
) {
  const promptText = prompt.trim();
  const fallbackTitle = createFallbackSessionTitle(promptText);
  if (!promptText || !llm.enabled || !llm.baseUrl.trim() || !llm.model.trim()) {
    return fallbackTitle;
  }

  try {
    return (await generator(promptText, llm)) || fallbackTitle;
  } catch {
    return fallbackTitle;
  }
}

export async function generateSessionTitleWithLlm(
  prompt: string,
  llm: PromptEnhancerPreferences["llm"],
) {
  const response = await fetch(
    resolveSessionTitleChatCompletionsUrl(llm.baseUrl),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(llm.apiKey.trim()
          ? { Authorization: `Bearer ${llm.apiKey.trim()}` }
          : {}),
      },
      body: JSON.stringify({
        model: llm.model.trim(),
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content:
              "你是会话命名器。根据用户最近的对话内容生成一个简短、精准的中文标题。标题要求：2-5个中文字，绝对不要超过5个字，不要包含任何标点符号、空格、数字或特殊字符。只输出标题文字，不要解释。",
          },
          { role: "user", content: prompt },
        ],
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Session title LLM failed: ${response.status}`);
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return normalizeGeneratedSessionTitle(
    data.choices?.[0]?.message?.content ?? "",
  );
}

export function resolveSessionTitleChatCompletionsUrl(baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/+$/u, "");
  if (normalized.endsWith("/chat/completions")) {
    return normalized;
  }
  if (normalized.endsWith("/v1")) {
    return `${normalized}/chat/completions`;
  }
  return `${normalized}/v1/chat/completions`;
}
