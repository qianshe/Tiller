type ListMarker = {
  indentation: string;
  marker: string;
  spacing: string;
  contentStart: number;
  content: string;
  orderedNumber?: number;
  orderedDelimiter?: "." | ")";
};

export type MarkdownLineBreakResult = {
  nextValue: string;
  nextCaret: number;
};

const LIST_MARKER_PATTERN = /^([ \t]*)([-+*]|(\d+)([.)]))([ \t]+)(.*)$/u;
const TYPED_LIST_MARKER_PATTERN = /^([-+*]|\d+[.)]) $/u;
const FENCE_PATTERN = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/u;
const AUTO_LIST_INDENT = "  ";

function clampSelection(value: string, selectionStart: number, selectionEnd: number) {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  return { start, end };
}

export function indentTypedMarkdownListMarker(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): MarkdownLineBreakResult | null {
  const { start, end } = clampSelection(value, selectionStart, selectionEnd);
  if (start !== end) {
    return null;
  }

  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const lineEndIndex = value.indexOf("\n", start);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  if (start !== lineEnd) {
    return null;
  }

  if (isInsideFencedCode(value, lineStart)) {
    return null;
  }

  const line = value.slice(lineStart, lineEnd).replace(/\r$/u, "");
  if (!TYPED_LIST_MARKER_PATTERN.test(line)) {
    return null;
  }

  const nextValue = `${value.slice(0, lineStart)}${AUTO_LIST_INDENT}${value.slice(lineStart)}`;
  return {
    nextValue,
    nextCaret: start + AUTO_LIST_INDENT.length,
  };
}

function insertPlainLineBreak(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): MarkdownLineBreakResult {
  const nextValue = `${value.slice(0, selectionStart)}\n${value.slice(selectionEnd)}`;
  return {
    nextValue,
    nextCaret: selectionStart + 1,
  };
}

function parseListMarker(line: string): ListMarker | null {
  const match = LIST_MARKER_PATTERN.exec(line);
  if (!match) {
    return null;
  }

  const indentation = match[1] ?? "";
  const marker = match[2] ?? "";
  const spacing = match[5] ?? " ";
  const content = match[6] ?? "";
  const orderedDigits = match[3];
  const orderedDelimiter = match[4];
  const contentStart = indentation.length + marker.length + spacing.length;

  if (orderedDigits && (orderedDelimiter === "." || orderedDelimiter === ")")) {
    return {
      indentation,
      marker,
      spacing,
      contentStart,
      content,
      orderedNumber: Number(orderedDigits),
      orderedDelimiter,
    };
  }

  if (marker === "-" || marker === "+" || marker === "*") {
    return {
      indentation,
      marker,
      spacing,
      contentStart,
      content,
    };
  }

  return null;
}

function parseFence(line: string) {
  const match = FENCE_PATTERN.exec(line);
  if (!match) {
    return null;
  }
  const fence = match[1] ?? "";
  const suffix = match[2] ?? "";
  return {
    marker: fence[0] as "`" | "~",
    length: fence.length,
    suffix,
  };
}

function isInsideFencedCode(value: string, lineStart: number) {
  let activeFence: { marker: "`" | "~"; length: number } | null = null;

  for (const rawLine of value.slice(0, lineStart).split("\n")) {
    const line = rawLine.replace(/\r$/u, "");
    const fence = parseFence(line);
    if (!fence) {
      continue;
    }

    if (!activeFence) {
      activeFence = { marker: fence.marker, length: fence.length };
      continue;
    }

    if (
      fence.marker === activeFence.marker &&
      fence.length >= activeFence.length &&
      !fence.suffix.trim()
    ) {
      activeFence = null;
    }
  }

  return activeFence !== null;
}

export function insertMarkdownLineBreak(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): MarkdownLineBreakResult {
  const { start, end } = clampSelection(value, selectionStart, selectionEnd);
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const lineEndIndex = value.indexOf("\n", start);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;

  if (end > lineEnd || isInsideFencedCode(value, lineStart)) {
    return insertPlainLineBreak(value, start, end);
  }

  const line = value.slice(lineStart, lineEnd).replace(/\r$/u, "");
  const listMarker = parseListMarker(line);
  if (!listMarker || start < lineStart + listMarker.contentStart) {
    return insertPlainLineBreak(value, start, end);
  }

  if (!listMarker.content.trim()) {
    const prefix = value.slice(0, lineStart);
    const suffix = value.slice(lineEnd);
    return {
      nextValue: `${prefix}\n${suffix}`,
      nextCaret: prefix.length + 1,
    };
  }

  const nextMarker = listMarker.orderedNumber !== undefined
    ? `${listMarker.indentation}${listMarker.orderedNumber + 1}${listMarker.orderedDelimiter}${listMarker.spacing}`
    : `${listMarker.indentation}${listMarker.marker}${listMarker.spacing}`;
  const insertedText = `\n${nextMarker}`;
  const nextValue = `${value.slice(0, start)}${insertedText}${value.slice(end)}`;
  return {
    nextValue,
    nextCaret: start + insertedText.length,
  };
}
