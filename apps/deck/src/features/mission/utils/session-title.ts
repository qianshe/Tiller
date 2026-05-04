import type { PromptEnhancerPreferences } from "../../prompt-enhancer/enhancer";

export function createFallbackSessionTitle(prompt: string) {
  return prompt.replace(/[\p{P}\p{S}\s]+/gu, "").slice(0, 5) || "新任务";
}

export function normalizeGeneratedSessionTitle(value: string) {
  return value.replace(/["'“”‘’`#：:，,。.!！?？\s]+/gu, "").slice(0, 12);
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
              "你是会话命名器。根据用户输入生成一个中文短标题，只输出标题本身，5到10个字，不要标点。",
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
