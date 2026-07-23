// Clipboard helper that survives non-secure contexts.
//
// navigator.clipboard.writeText is only available in secure contexts
// (HTTPS or localhost). Tiller's mobile flow often reaches Helm over a
// LAN IP via plain HTTP, where navigator.clipboard is undefined and the
// async clipboard API silently rejects. We fall back to the legacy
// execCommand("copy") path so copy buttons keep working there.

type ClipboardLike = Pick<Clipboard, "writeText">;

export async function copyTextToClipboard(
  text: string,
  clipboard: ClipboardLike | undefined,
): Promise<void> {
  if (!text.trim()) {
    throw new Error("Clipboard unavailable");
  }
  if (clipboard?.writeText) {
    await clipboard.writeText(text);
    return;
  }
  if (!copyTextViaTextArea(text)) {
    throw new Error("Clipboard unavailable");
  }
}

function copyTextViaTextArea(text: string): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  return ok;
}
