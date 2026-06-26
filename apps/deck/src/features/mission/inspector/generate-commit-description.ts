import { resolveChatCompletionsUrl } from "../../prompt-enhancer/facade";
import type { DeckPreferences } from "../../preferences/storage";

export type GenerateCommitDescriptionInput = {
  selectedChanges: Array<{
    path: string;
    status: "modified" | "added" | "deleted";
    patch?: string;
  }>;
  llmConfig: DeckPreferences["promptEnhancer"]["llm"];
};

const COMMIT_MESSAGE_SYSTEM_PROMPT = `## Commit message

You are an expert at writing Git commits. Your job is to write a short clear commit message that summarizes the changes.

If you can accurately express the change in just the subject line, don't include anything in the message body. Only use the body when it is providing *useful* information.

Don't repeat information from the subject line in the message body.

Only return the commit message in your response. Do not include any additional meta-commentary about the task. Do not include the raw diff output in the commit message.

Follow good Git style:

- Separate the subject from the body with a blank line
- Try to limit the subject line to 50 characters
- Capitalize the subject line
- Do not end the subject line with any punctuation
- Use the imperative mood in the subject line
- Wrap the body at 72 characters
- Keep the body short and concise (omit it entirely if not useful)
- 使用中文
- 用标准格式，如：
feat：标题
内容`;

export async function generateCommitDescription(
  input: GenerateCommitDescriptionInput,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const { selectedChanges, llmConfig } = input;

  if (!llmConfig || !llmConfig.baseUrl.trim() || !llmConfig.model.trim()) {
    throw new Error("LLM configuration is incomplete");
  }

  const userPrompt = buildCommitMessagePrompt(selectedChanges);

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
        { role: "system", content: COMMIT_MESSAGE_SYSTEM_PROMPT },
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

function buildCommitMessagePrompt(
  changes: GenerateCommitDescriptionInput["selectedChanges"],
) {
  const normalizedChanges = changes.slice(0, 24).map((change) => {
    const patchSummary = summarizePatch(change.patch);
    return [
      `- 文件: ${change.path}`,
      `  状态: ${change.status}`,
      patchSummary ? `  摘要: ${patchSummary}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  });

  return [
    "# Git 变更",
    normalizedChanges.join("\n"),
    "",
    "请基于以上 Git 变更生成一条 commit message。",
  ].join("\n");
}

function summarizePatch(patch: string | undefined) {
  if (!patch?.trim()) {
    return "";
  }
  const lines = patch
    .split(/\r?\n/u)
    .filter((line) =>
      line.startsWith("@@") ||
      (line.startsWith("+") && !line.startsWith("+++")) ||
      (line.startsWith("-") && !line.startsWith("---")),
    )
    .slice(0, 8)
    .map((line) => line.trim())
    .join(" ");
  return lines.length > 320 ? `${lines.slice(0, 320)}...` : lines;
}
