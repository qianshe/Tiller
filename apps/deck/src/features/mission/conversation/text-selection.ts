import type { MissionPromptContextItem } from "@tiller/shared";

export function normalizeQuotedSelection(text: string) {
  const excerpt = text.trim();
  if (!excerpt) {
    return null;
  }
  return { excerpt };
}

const REVIEW_CONTEXT_TITLE_QUOTE_PREVIEW_MAX = 24;

export function resolveReviewContextTitle(item: MissionPromptContextItem): string {
  if (item.kind === "diff") {
    const fileName = item.source.filePath.split(/[\\/]/u).at(-1) ?? item.source.filePath;
    return item.source.startLine === item.source.endLine
      ? `${fileName}:${item.source.startLine}`
      : `${fileName}:${item.source.startLine}-${item.source.endLine}`;
  }
  const preview = item.excerpt.replace(/\s+/gu, " ").trim();
  return preview.length > REVIEW_CONTEXT_TITLE_QUOTE_PREVIEW_MAX
    ? `${preview.slice(0, REVIEW_CONTEXT_TITLE_QUOTE_PREVIEW_MAX)}…`
    : preview;
}
