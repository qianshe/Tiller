import type { CommandChunk } from "@tiller/shared";
import type { HelmHandlerContext } from "../../../handlers/context";

const MAX_INLINE_COMMAND_OUTPUT_BYTES = 4 * 1024;
const COMMAND_OUTPUT_PREVIEW_CHARS = 1024;

export function materializeRuntimeCommandOutputChunk(
  context: HelmHandlerContext,
  sessionId: string,
  chunk: CommandChunk,
) {
  const byteSize = Buffer.byteLength(chunk.text, "utf8");
  if (byteSize <= MAX_INLINE_COMMAND_OUTPUT_BYTES) {
    return {
      ...chunk,
      byteSize,
    };
  }
  const stored = context.sessionOutputBodyStore.putText({
    sessionId,
    outputId: chunk.id,
    text: chunk.text,
  });
  return {
    ...chunk,
    text: chunk.text.slice(0, COMMAND_OUTPUT_PREVIEW_CHARS),
    truncated: true,
    byteSize,
    contentRef: {
      id: stored.outputId,
      uri: stored.uri,
      mimeType: stored.mimeType,
      byteSize: stored.byteSize,
      sha256: stored.sha256,
    },
  };
}
