import { useState, type ClipboardEvent as ReactClipboardEvent } from "react";
import type { AgentPromptImageContent, SessionSummary } from "@tiller/shared";
import {
  createPromptImageContent,
  extractClipboardImageItems,
  formatClipboardImageNotice,
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

  async function addPromptImageFiles(files: File[] | FileList | null) {
    const images = Array.from(files ?? []).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (!images.length) {
      return;
    }
    if (activeSession?.imageInput === false) {
      setImagePasteNotice("当前 Agent 不支持图片输入，无法添加图片喵~");
      return;
    }
    try {
      const startIndex = promptImages.length;
      const nextImages = await Promise.all(
        images.map((file, index) => createPromptImageContent(file, startIndex + index)),
      );
      setPromptImages((current) => [...current, ...nextImages]);
      setImagePasteNotice(formatClipboardImageNotice(images));
    } catch {
      setImagePasteNotice("图片添加失败：无法读取图片内容。");
    }
  }

  async function handlePromptPaste(
    event: ReactClipboardEvent<HTMLTextAreaElement>,
  ) {
    const images = extractClipboardImageItems(event.clipboardData);
    if (!images.length) {
      return;
    }
    event.preventDefault();
    await addPromptImageFiles(images);
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
    addPromptImageFiles,
    removePromptImage,
  };
}
