import type { AgentToolCall } from "../types";

const DATA_IMAGE_PREFIX = "data:image/";
const DATA_IMAGE_BASE64_HEADER_PATTERN =
  /data:image\/[A-Za-z0-9.+-]+;base64,/iu;
const DATA_IMAGE_BASE64_PATTERN =
  /data:image\/[A-Za-z0-9.+-]+;base64,[-A-Za-z0-9+/_=]*/giu;
const IMAGE_CONTENT_OMITTED_LABEL = "[image content omitted from history]";

export function compactBinaryToolCallOutput(toolCall: AgentToolCall): AgentToolCall {
  if (
    !toolCall.output ||
    !DATA_IMAGE_BASE64_HEADER_PATTERN.test(toolCall.output)
  ) {
    return toolCall;
  }
  const compactedOutput =
    toolCall.kind === "read"
      ? summarizeInlineImageOutput(toolCall)
      : compactInlineImageData(toolCall.output);
  if (!compactedOutput) {
    return toolCall;
  }
  return compactedOutput === toolCall.output
    ? toolCall
    : { ...toolCall, output: compactedOutput };
}

function compactInlineImageData(output: string): string {
  const parsed = parseJsonValue(output);
  if (parsed !== null) {
    return JSON.stringify(replaceInlineImageData(parsed));
  }
  return replaceInlineImageDataInString(output);
}

function replaceInlineImageData(value: unknown): unknown {
  if (typeof value === "string") {
    return replaceInlineImageDataInString(value);
  }
  if (Array.isArray(value)) {
    return value.map(replaceInlineImageData);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        replaceInlineImageData(item),
      ]),
    );
  }
  return value;
}

function replaceInlineImageDataInString(value: string): string {
  return value.replace(DATA_IMAGE_BASE64_PATTERN, IMAGE_CONTENT_OMITTED_LABEL);
}

function summarizeInlineImageOutput(toolCall: AgentToolCall) {
  const output = toolCall.output?.trim();
  if (!output || !output.includes(DATA_IMAGE_PREFIX)) {
    return undefined;
  }

  const input = parseJsonRecord(toolCall.input);
  const imageInfo = readFirstInlineImageInfo(output);
  const path = firstString(
    input?.path,
    input?.file_path,
    input?.relative_path,
    looksLikeFilePath(toolCall.title) ? toolCall.title : undefined,
  );
  const mimeType = imageInfo?.mimeType;
  const detail = firstString(input?.detail, imageInfo?.detail);

  return [
    IMAGE_CONTENT_OMITTED_LABEL,
    ...(path ? [`path: ${path}`] : []),
    ...(mimeType ? [`mimeType: ${mimeType}`] : []),
    ...(detail ? [`detail: ${detail}`] : []),
  ].join("\n");
}

function readFirstInlineImageInfo(output: string) {
  const parsed = parseJsonValue(output);
  const candidates = Array.isArray(parsed) ? parsed : [parsed];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      continue;
    }
    const record = candidate as Record<string, unknown>;
    const imageUrl = firstString(record.image_url, record.imageUrl);
    if (!imageUrl?.startsWith(DATA_IMAGE_PREFIX)) {
      continue;
    }
    return {
      mimeType: readDataImageMimeType(imageUrl),
      detail: firstString(record.detail),
    };
  }
  const mimeType = readDataImageMimeType(output);
  return mimeType ? { mimeType } : undefined;
}

function readDataImageMimeType(value: string) {
  const match = /data:(image\/[A-Za-z0-9.+-]+);base64,/u.exec(value);
  return match?.[1];
}

function parseJsonRecord(input: string | undefined) {
  const parsed = parseJsonValue(input);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
}

function parseJsonValue(input: string | undefined) {
  if (!input) {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function looksLikeFilePath(value: string) {
  const trimmed = value.trim();
  return Boolean(trimmed) && /[\\/]/u.test(trimmed) && !/\r|\n/u.test(trimmed);
}
