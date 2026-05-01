import type { AgentPromptImageContent } from "@tiller/shared";

type ClipboardImageItem = {
  kind?: string;
  type?: string;
  getAsFile?: () => File | null;
};

type ClipboardDataWithItems = {
  items?: Iterable<ClipboardImageItem> | ArrayLike<ClipboardImageItem>;
};

function toArray<T>(items: Iterable<T> | ArrayLike<T> | undefined): T[] {
  if (!items) {
    return [];
  }
  return Array.from(items as Iterable<T> | ArrayLike<T>);
}

export function extractClipboardImageItems(clipboardData: ClipboardDataWithItems | null | undefined): File[] {
  return toArray(clipboardData?.items)
    .filter((item) => item.kind === "file" && item.type?.startsWith("image/"))
    .map((item) => item.getAsFile?.() ?? null)
    .filter((file): file is File => Boolean(file));
}

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) {
    return "0 B";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return btoa(binary);
}

export async function createClipboardImageContent(file: File, index: number): Promise<AgentPromptImageContent> {
  const name = file.name || `clipboard-image-${index + 1}.png`;
  return {
    type: "image",
    data: arrayBufferToBase64(await file.arrayBuffer()),
    mimeType: file.type || "image/png",
    name,
    uri: `tiller:///agent/pasted-image?name=${encodeURIComponent(name)}&index=${index}`,
  };
}

export function formatClipboardImageNotice(files: File[]) {
  const first = files[0];
  if (!first) {
    return "";
  }
  const label = `${first.name || "clipboard-image"}（${first.type || "image/*"}，${formatBytes(first.size)}）`;
  const suffix = files.length > 1 ? `等 ${files.length} 张图片` : label;
  return `已添加图片：${suffix}。发送时会作为 ACP image content 随提示词传输。`;
}
