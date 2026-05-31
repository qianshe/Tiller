import type { AgentPromptImageContent } from "@tiller/shared";

const IMAGE_PART_TYPES = new Set(["image", "image_url", "input_image"]);

export function collectHistoryImageAttachments(
  parts: unknown,
  messageId: string,
): AgentPromptImageContent[] {
  if (!Array.isArray(parts)) {
    return [];
  }

  const images: AgentPromptImageContent[] = [];
  for (const [index, part] of parts.entries()) {
    const image = historyImagePartToAttachment(
      part,
      `${messageId}-image-${images.length + 1}`,
      index,
    );
    if (image) {
      images.push(image);
    }
  }
  return images;
}

function historyImagePartToAttachment(
  part: unknown,
  fallbackName: string,
  partIndex: number,
): AgentPromptImageContent | null {
  const record = recordFrom(part);
  if (!record) {
    return null;
  }

  const source =
    recordFrom(record.source)
    ?? recordFrom(record.image)
    ?? recordFrom(record.image_url)
    ?? recordFrom(record.imageUrl)
    ?? recordFrom(record.input_image)
    ?? recordFrom(record.inputImage)
    ?? record;
  const dataUrl = firstString(
    source.url,
    source.uri,
    source.image_url,
    source.imageUrl,
    record.url,
    record.uri,
    record.image_url,
    record.imageUrl,
  );
  const dataUrlImage = dataUrl ? parseDataImageUrl(dataUrl) : null;
  const mimeType =
    firstString(
      source.media_type,
      source.mediaType,
      source.mime_type,
      source.mimeType,
      record.media_type,
      record.mediaType,
      record.mime_type,
      record.mimeType,
    )
    ?? dataUrlImage?.mimeType
    ?? "image/png";
  const data =
    firstString(
      source.data,
      source.base64,
      source.b64_json,
      record.data,
      record.base64,
      record.b64_json,
    )
    ?? dataUrlImage?.data;

  if (!isLikelyImagePart(record, mimeType, dataUrlImage !== null) || !data) {
    return null;
  }

  const uri = firstString(source.uri, record.uri);
  return {
    type: "image",
    data,
    mimeType,
    ...(uri && !uri.startsWith("data:") ? { uri } : {}),
    name:
      firstString(record.name, source.name, record.filename, source.filename, record.fileName, source.fileName)
      ?? `${fallbackName}.${imageExtensionFromMimeType(mimeType, partIndex)}`,
  };
}

function isLikelyImagePart(
  record: Record<string, unknown>,
  mimeType: string,
  hasDataImageUrl: boolean,
) {
  const type = stringFrom(record.type)?.toLowerCase();
  return (
    hasDataImageUrl
    || (type !== undefined && IMAGE_PART_TYPES.has(type))
    || mimeType.toLowerCase().startsWith("image/")
  );
}

function parseDataImageUrl(value: string) {
  const match = /^data:([^;,]+);base64,(.+)$/iu.exec(value.trim());
  if (!match) {
    return null;
  }
  return { mimeType: match[1] ?? "image/png", data: match[2] ?? "" };
}

function imageExtensionFromMimeType(mimeType: string, fallbackIndex: number) {
  const subtype = mimeType.split("/").at(1)?.replace(/[^a-z0-9.+-]/giu, "").toLowerCase();
  if (!subtype) {
    return `image-${fallbackIndex + 1}`;
  }
  return subtype === "jpeg" ? "jpg" : subtype;
}

function recordFrom(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string");
}

function stringFrom(value: unknown) {
  return typeof value === "string" ? value : undefined;
}
