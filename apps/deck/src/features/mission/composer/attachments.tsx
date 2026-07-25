import type { AgentPromptImageContent, MissionPromptContextItem } from "@tiller/shared";
import { resolveReviewContextTitle } from "../conversation/text-selection";
import { PromptContextMenu } from "../ui/prompt-context-menu";

type ComposerAttachmentsProps = {
  promptImages: AgentPromptImageContent[];
  removePromptImage: (index: number) => void;
  reviewContext?: {
    draftContexts: MissionPromptContextItem[];
    removeDraftContext: (id: string) => void;
  };
};

/**
 * Shows selected image chips above the prompt textbox.
 */
export function ComposerAttachments({
  promptImages,
  removePromptImage,
  reviewContext,
}: ComposerAttachmentsProps) {
  const draftContexts = reviewContext?.draftContexts ?? [];
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
              className="mission-composer-attachment mission-attachment-chip inline-flex items-center gap-1 rounded border border-border-ghost bg-surface-emphasis px-2 py-1 text-xs"
            >
              <span className="text-muted-foreground">📎</span>
              <span>图片 {index + 1}</span>
              <button
                type="button"
                className="mission-composer-attachment-remove ml-1 flex h-4 w-4 items-center justify-center rounded hover:bg-surface-sunken"
                onClick={() => removePromptImage(index)}
                aria-label={`移除图片 ${index + 1}`}
                title="移除"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {draftContexts.length ? (
        <div
          className="mission-composer-attachments mission-attachment-strip"
          aria-label="待发送评论上下文"
        >
          <PromptContextMenu
            contexts={draftContexts}
            onRemoveContext={reviewContext?.removeDraftContext}
            resolveTitle={resolveReviewContextTitle}
          />
        </div>
      ) : null}
    </>
  );
}
