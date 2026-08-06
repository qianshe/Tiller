export type MissionPromptContextItem =
  | {
      id: string;
      kind: "diff";
      label: string;
      comment: string;
      excerpt: string;
      source: { kind: "diff"; filePath: string; startLine: number; endLine: number };
    }
  | {
      id: string;
      kind: "quote";
      label: string;
      comment: string;
      excerpt: string;
      source: { kind: "quote"; messageId: string; role: "assistant" | "system" | "user" };
    };

const CONTEXT_JSON_OPEN = "[TILLER_CONTEXT_JSON_V1]";
const CONTEXT_JSON_CLOSE = "[/TILLER_CONTEXT_JSON_V1]";
const CONTEXT_OPEN = "[TILLER_CONTEXT]";
const CONTEXT_CLOSE = "[/TILLER_CONTEXT]";
const PROMPT_OPEN = "[TILLER_USER_PROMPT]";
const PROMPT_CLOSE = "[/TILLER_USER_PROMPT]";

export function parseSlashCommandName(text: string) {
  const match = /^\s*\/(\S+)/u.exec(text);
  return match?.[1]?.replace(/^\/+/, "") ?? null;
}

export function buildMissionPromptText(prompt: string, contexts: MissionPromptContextItem[]) {
  if (!contexts.length) {
    return prompt;
  }

  const json = JSON.stringify(contexts);
  const readable = contexts.map((item, index) => [
    `${index + 1}. ${item.kind === "diff" ? "Diff Comment" : "Quote Comment"}`,
    `- label: ${item.label}`,
    `- note: ${item.comment}`,
    "- excerpt:",
    item.kind === "diff" ? "```diff" : ">",
    item.excerpt,
    item.kind === "diff" ? "```" : "",
  ].filter(Boolean).join("\n")).join("\n\n");

  return [
    CONTEXT_JSON_OPEN,
    json,
    CONTEXT_JSON_CLOSE,
    CONTEXT_OPEN,
    readable,
    CONTEXT_CLOSE,
    PROMPT_OPEN,
    prompt,
    PROMPT_CLOSE,
  ].join("\n");
}

export function parseMissionPromptContext(text: string) {
  const jsonBlock = readTaggedBlock(text, CONTEXT_JSON_OPEN, CONTEXT_JSON_CLOSE);
  const body = readTaggedBlock(text, PROMPT_OPEN, PROMPT_CLOSE) ?? text;
  let contexts: MissionPromptContextItem[] = [];

  if (jsonBlock) {
    try {
      contexts = JSON.parse(jsonBlock) as MissionPromptContextItem[];
    } catch {
      contexts = [];
    }
  }

  return { contexts, body };
}

export function stripMissionPromptContext(text: string) {
  return parseMissionPromptContext(text).body;
}

function readTaggedBlock(text: string, open: string, close: string) {
  const start = text.indexOf(open);
  if (start === -1) {
    return null;
  }
  const contentStart = start + open.length;
  const end = text.indexOf(close, contentStart);
  if (end === -1) {
    return null;
  }
  return text.slice(contentStart, end).replace(/^\n/u, "").replace(/\n$/u, "");
}
