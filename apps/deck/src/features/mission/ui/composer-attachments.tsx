import type { AgentPromptImageContent } from "@tiller/shared";

type ComposerAttachmentsProps = {
  promptImages: AgentPromptImageContent[];
  removePromptImage: (index: number) => void;
  imagePasteNotice: string;
};

/**
 * Shows pasted image chips and paste feedback above the prompt textbox.
 */
export function ComposerAttachments({
  promptImages,
  removePromptImage,
  imagePasteNotice,
}: ComposerAttachmentsProps) {
  return (
    <>
      {promptImages.length ? (
        <div
          className="mission-composer-attachments mission-attachment-strip"
          aria-label="待发送图片"
        >
          {promptImages.map((image, index) => (
            <span
              key={`${image.uri ?? image.name}-${index}`}
              className="mission-composer-attachment mission-attachment-chip"
            >
              image {index + 1}
              <button
                type="button"
                className="mission-composer-attachment-remove"
                onClick={() => removePromptImage(index)}
                aria-label={`移除 image ${index + 1}`}
                title="移除"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {imagePasteNotice ? (
        <p className="subtle compact mission-composer-notice">
          {imagePasteNotice}
        </p>
      ) : null}
    </>
  );
}
