import { useState, type ClipboardEvent as ReactClipboardEvent } from "react";
import type { AgentPromptImageContent, SessionSummary } from "@tiller/shared";
import {
  createClipboardImageContent,
  extractClipboardImageItems,
} from "../utils/clipboard";

type UsePromptImagesOptions = {
  activeSession: SessionSummary | null;
};

/** Handles prompt image paste state and image removal for the composer. */
export function usePromptImages({ activeSession }: UsePromptImagesOptions) {
  const [promptImages, setPromptImages] = useState<AgentPromptImageContent[]>(
    [],
  );
  const [imagePasteNotice, setImagePasteNotice] = useState("");

  async function handlePromptPaste(
    event: ReactClipboardEvent<HTMLTextAreaElement>,
  ) {
    const images = extractClipboardImageItems(event.clipboardData);
    if (!images.length) {
      return;
    }
    event.preventDefault();
    if (activeSession?.imageInput === false) {
      setImagePasteNotice("当前 Agent 不支持图片输入，无法粘贴图片喵~");
      return;
    }
    try {
      const startIndex = promptImages.length;
      const nextImages = await Promise.all(
        images.map((file, index) =>
          createClipboardImageContent(file, startIndex + index),
        ),
      );
      setPromptImages((current) => [...current, ...nextImages]);
      setImagePasteNotice("");
    } catch {
      setImagePasteNotice("图片粘贴失败：无法读取剪贴板图片内容。");
    }
  }

  function removePromptImage(index: number) {
    setPromptImages((current) => current.filter((_, i) => i !== index));
  }

  return {
    promptImages,
    setPromptImages,
    imagePasteNotice,
    setImagePasteNotice,
    handlePromptPaste,
    removePromptImage,
  };
}
