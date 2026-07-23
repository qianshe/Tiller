export function mergeStreamingText(
  currentText: string | undefined,
  incomingText: string | undefined,
  mode: "auto" | "delta" | "snapshot" = "auto",
) {
  if (!incomingText) {
    return currentText;
  }
  if (!currentText) {
    return incomingText;
  }
  if (mode === "delta") {
    return `${currentText}${incomingText}`;
  }
  if (mode === "snapshot") {
    return incomingText;
  }
  if (currentText === incomingText) {
    return currentText;
  }
  if (incomingText.startsWith(currentText)) {
    return incomingText;
  }
  if (
    currentText.startsWith(incomingText) ||
    currentText.endsWith(incomingText)
  ) {
    return currentText;
  }
  if (currentText.length >= 16 && incomingText.includes(currentText)) {
    return incomingText;
  }
  if (incomingText.length >= 16 && currentText.includes(incomingText)) {
    return currentText;
  }

  const lineOverlapMerged = mergeTextByLineOverlap(currentText, incomingText);
  if (lineOverlapMerged !== `${currentText}${incomingText}`) {
    return collapseRepeatedStreamingText(lineOverlapMerged);
  }

  const charOverlapMerged = mergeTextByCharacterOverlap(currentText, incomingText);
  return collapseRepeatedStreamingText(charOverlapMerged);
}

export function isAssistantSnapshotContinuation(
  currentText: string | undefined,
  incomingText: string | undefined,
) {
  if (!currentText || !incomingText) {
    return false;
  }
  return incomingText.startsWith(currentText) ||
    currentText.startsWith(incomingText);
}

export function shouldStartNewAssistantOccurrenceAfterBoundary(
  currentText: string | undefined,
  incomingText: string | undefined,
  boundaryPresent: boolean,
) {
  return boundaryPresent &&
    !isAssistantSnapshotContinuation(currentText, incomingText);
}

export function collapseRepeatedStreamingText(text: string) {
  const minUnitLength = 8;
  const maxUnitLength = Math.floor(text.length / 2);
  for (let unitLength = minUnitLength; unitLength <= maxUnitLength; unitLength += 1) {
    if (text.length % unitLength !== 0) {
      continue;
    }

    const unit = text.slice(0, unitLength);
    let repeatsExactly = true;
    for (let index = unitLength; index < text.length; index += unitLength) {
      if (text.slice(index, index + unitLength) !== unit) {
        repeatsExactly = false;
        break;
      }
    }

    if (repeatsExactly) {
      return unit;
    }
  }
  return text;
}

function mergeTextByCharacterOverlap(currentText: string, incomingText: string) {
  const maxOverlap = Math.min(currentText.length, incomingText.length);
  for (let overlapLength = maxOverlap; overlapLength >= 8; overlapLength -= 1) {
    if (currentText.slice(-overlapLength) === incomingText.slice(0, overlapLength)) {
      return `${currentText}${incomingText.slice(overlapLength)}`;
    }
  }
  return `${currentText}${incomingText}`;
}

function mergeTextByLineOverlap(currentText: string, incomingText: string) {
  const currentLines = currentText.split(/\r?\n/);
  const incomingLines = incomingText.split(/\r?\n/);
  const maxOverlap = Math.min(currentLines.length, incomingLines.length);

  for (let overlapLength = maxOverlap; overlapLength >= 2; overlapLength -= 1) {
    const currentTail = currentLines.slice(-overlapLength).join("\n");
    const incomingHead = incomingLines.slice(0, overlapLength).join("\n");
    if (currentTail !== incomingHead) {
      continue;
    }
    return [
      ...currentLines,
      ...incomingLines.slice(overlapLength),
    ].join("\n");
  }

  return `${currentText}${incomingText}`;
}
