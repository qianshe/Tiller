export function normalizeLocalCommandMessageText(text: string) {
  const trimmed = text.trim();
  const stdout = extractTaggedContent(trimmed, "local-command-stdout");
  if (stdout !== undefined) {
    const normalized = stdout.trim();
    return shouldHideLocalCommandOutput(normalized) ? "" : normalized;
  }
  const stderr = extractTaggedContent(trimmed, "local-command-stderr");
  if (stderr !== undefined) {
    return stderr.trim();
  }
  if (/<(?:local-command-caveat|command-name|command-message|command-args)\b/iu.test(trimmed)) {
    return "";
  }
  return text;
}

function shouldHideLocalCommandOutput(text: string) {
  return /^Set model to\b/iu.test(text);
}

function extractTaggedContent(text: string, tagName: string) {
  const match = text.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "iu"));
  return match?.[1];
}
