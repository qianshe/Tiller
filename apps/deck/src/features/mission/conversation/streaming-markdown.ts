type MarkdownFenceState = {
  marker: "`" | "~";
  length: number;
};

type StreamingMarkdownSegment = {
  markdown: string;
  tail: string;
};

export function splitStreamingMarkdown(text: string): StreamingMarkdownSegment | null {
  const splitIndex = findStreamingMarkdownSplitIndex(text);
  if (splitIndex === null) {
    return null;
  }
  const markdown = text.slice(0, splitIndex).trimEnd();
  if (!markdown.trim()) {
    return null;
  }
  return {
    markdown,
    tail: text.slice(splitIndex).replace(/^\r?\n/u, ""),
  };
}

function findStreamingMarkdownSplitIndex(text: string) {
  let splitIndex: number | null = null;
  let fence: MarkdownFenceState | null = null;
  const linePattern = /.*(?:\r?\n|$)/gu;
  let match: RegExpExecArray | null;
  while ((match = linePattern.exec(text))) {
    const line = match[0];
    if (!line) {
      break;
    }
    const lineEnd = match.index + line.length;
    const marker = /^[ \t]*(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker) {
      const markerKind = marker[0] as "`" | "~";
      if (fence && fence.marker === markerKind && marker.length >= fence.length) {
        fence = null;
        splitIndex = lineEnd;
      } else if (!fence) {
        fence = { marker: markerKind, length: marker.length };
      }
    }
    if (!fence && /^\s*$/u.test(line) && match.index > 0) {
      splitIndex = lineEnd;
    }
    if (lineEnd >= text.length) {
      break;
    }
  }
  return splitIndex;
}
