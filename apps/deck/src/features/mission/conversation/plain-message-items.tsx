import {
  memo,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from "react";
import { createPortal } from "react-dom";
import type {
  AgentMessage,
  AgentPromptImageContent,
  AgentToolCall,
  MissionPromptContextItem,
  SessionTimelineThinkingChunk,
  SessionSubagentDetail,
} from "@tiller/shared";
import {
  parseMissionPromptContext,
  stripMissionPromptContext,
} from "@tiller/shared";
import { DAEMON_HOST_KEY, DAEMON_PORT_KEY } from "../../helm-connection/helm-endpoint";
import {
  Badge,
  Button,
  Icon,
} from "../../../shared/ui";
import { MarkdownMessage } from "../../../shared/ui/markdown";
import type { ConversationToolCallItem } from "../../logbook";
import { resolveToolCallTone } from "../../logbook/tool-call-tone";
import { cn } from "../../../shared/utils/cn";
import { copyTextToClipboard } from "../../../shared/utils/clipboard";
import {
  formatToolInputPreview,
  isActiveToolStatus,
  resolveToolCallIconName,
  resolveToolStatusLabel,
} from "./plain-tool-model";
import { splitStreamingMarkdown } from "./streaming-markdown";
import {
  resolveToolCallChangeStats,
  resolveToolCallDiff,
} from "./tool-call-change-stats";
import { ToolCallDiffPreview } from "./tool-call-diff-preview";
import { resolveCodexSubagentPresentation } from "./codex-subagent-presentation";
import { normalizeQuotedSelection, resolveReviewContextTitle } from "./text-selection";
import { SelectionCommentPopover } from "../ui/selection-comment-popover";
import { PromptContextMenu } from "../ui/prompt-context-menu";

const DEFAULT_ATTACHMENT_HOST = "127.0.0.1";
const DEFAULT_ATTACHMENT_PORT = "47631";
const COLLAPSED_MESSAGE_LINE_LIMIT = 3;
const COLLAPSED_MESSAGE_CHAR_LIMIT = 300;
const THINKING_SUMMARY_PREVIEW_MAX_CHARS = 72;
const THINKING_SCROLL_LINE_THRESHOLD = 12;
const THINKING_SCROLL_CHAR_THRESHOLD = 640;
const ASSISTANT_MESSAGE_FRAME_CLASS = "mr-auto w-[calc(100%-0.625rem)] max-w-[calc(100%-0.625rem)]";
const ASSISTANT_MESSAGE_RAIL_CLASS = "grid-cols-[0.375rem_minmax(0,1fr)] gap-x-1";
const USER_MESSAGE_RAIL_CLASS = "w-fit max-w-[min(56rem,76%)]";
const TOOL_CATEGORY_SLOT_CLASS_NAME = "min-w-[3.25rem]";

type MessageImageSourceEnvironment = {
  location?: Pick<Location, "protocol" | "hostname" | "port">;
  storage?: Pick<Storage, "getItem">;
};

type PlainMessageImagePreview = {
  alt: string;
  caption: string;
  src: string;
};

export function resolveMessageImageSource(
  image: AgentPromptImageContent,
  environment: MessageImageSourceEnvironment = resolveBrowserImageSourceEnvironment(),
) {
  if (image.data) {
    return `data:${image.mimeType};base64,${image.data}`;
  }
  if (!image.uri) {
    return undefined;
  }
  return resolveAttachmentImageUri(image.uri, environment);
}

function resolveBrowserImageSourceEnvironment(): MessageImageSourceEnvironment {
  if (typeof window === "undefined") {
    return {};
  }
  return {
    location: window.location,
    storage: window.localStorage,
  };
}

function resolveAttachmentImageUri(
  uri: string,
  environment: MessageImageSourceEnvironment,
) {
  if (!uri.startsWith("/api/") || !environment.location) {
    return uri;
  }
  const helmPort = environment.storage?.getItem(DAEMON_PORT_KEY) ?? DEFAULT_ATTACHMENT_PORT;
  if (!helmPort || environment.location.port === helmPort) {
    return uri;
  }
  const storedHost = environment.storage?.getItem(DAEMON_HOST_KEY);
  const helmHost = resolveAttachmentHost(storedHost, environment.location.hostname);
  return `${environment.location.protocol}//${helmHost}:${helmPort}${uri}`;
}

function resolveAttachmentHost(host: string | null | undefined, locationHostname: string) {
  if (!host || host === "0.0.0.0" || host === "::") {
    return locationHostname || DEFAULT_ATTACHMENT_HOST;
  }
  return host;
}

function PlainMessageImageAttachment({
  image,
  index,
  messageId,
  onPreview,
  tone,
}: {
  image: AgentPromptImageContent;
  index: number;
  messageId: string;
  onPreview: (preview: PlainMessageImagePreview) => void;
  tone: "assistant" | "user";
}) {
  const src = resolveMessageImageSource(image);
  if (!src) {
    return null;
  }
  const label = image.name ?? `粘贴图片 ${index + 1}`;
  return (
    <figure
      key={`${messageId}-image-${index}`}
      className={cn(
        "mission-message-image w-24 max-w-[28vw] shrink-0 overflow-hidden rounded-[10px] border border-border-ghost bg-surface-sunken",
        tone === "user"
          ? "shadow-[0_8px_24px_rgb(0_0_0/0.10)]"
          : "shadow-[0_8px_24px_rgb(0_0_0/0.08)]",
      )}
    >
      <button
        type="button"
        className="mission-message-image-preview-trigger block w-full text-left"
        aria-label={`放大查看 ${label}`}
        onClick={() => onPreview({ alt: label, caption: label, src })}
      >
        <img
          src={src}
          alt={label}
          className="h-14 w-full object-cover"
        />
      </button>
    </figure>
  );
}

function PlainMessageImageLightbox({
  image,
  onClose,
}: {
  image: PlainMessageImagePreview;
  onClose: () => void;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="mission-message-image-lightbox fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={image.caption}
      onClick={onClose}
    >
      <div
        className="max-h-full max-w-full overflow-hidden rounded-[10px] border border-border-ghost bg-surface shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-9 items-center gap-2 border-b border-border-ghost px-3">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{image.caption}</span>
          <button
            type="button"
            className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-surface-sunken hover:text-foreground"
            aria-label="关闭图片预览"
            onClick={onClose}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
        <img
          src={image.src}
          alt={image.alt}
          className="max-h-[calc(100vh-6rem)] max-w-[calc(100vw-2rem)] object-contain"
        />
      </div>
    </div>,
    document.body,
  );
}

function shouldCollapsePlainMessage(text: string) {
  const lineCount = text.split(/\r?\n/u).length;
  return (
    lineCount > COLLAPSED_MESSAGE_LINE_LIMIT ||
    text.length > COLLAPSED_MESSAGE_CHAR_LIMIT
  );
}

type PlainMessageItemProps = {
  assistantActions?: AssistantMessageActions;
  isExpanded: boolean;
  message: AgentMessage;
  onDismiss?: (messageId: string) => void;
  onToggleExpandedMessage: (messageId: string) => void;
  onAddDraftContext?: (item: MissionPromptContextItem) => void;
};

type AssistantMessageActions = {
  canHandoff?: boolean;
  copyText: string;
  handoffBusy?: boolean;
  onHandoff?: (assistantBlockText: string) => void;
};

export const PlainMessageItem = memo(function PlainMessageItem({
  assistantActions,
  isExpanded,
  message,
  onDismiss,
  onToggleExpandedMessage,
  onAddDraftContext,
}: PlainMessageItemProps) {
  const isSystem = message.role === "system";
  const isAssistant = message.role === "assistant";
  const isStreaming = isAssistant && message.streaming;
  const renderedUserPrompt = message.role === "user"
    ? parseMissionPromptContext(message.text)
    : null;
  const userBodyText = renderedUserPrompt?.body ?? message.text;
  const userPromptContexts = renderedUserPrompt?.contexts ?? [];
  const isCollapsible =
    message.role === "user" && shouldCollapsePlainMessage(userBodyText);
  const messageBodyClassName =
    isCollapsible && !isExpanded
      ? "plain-message-body plain-message-body-collapsed"
      : "plain-message-body";
  const [previewImage, setPreviewImage] = useState<PlainMessageImagePreview | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [quoteDraft, setQuoteDraft] = useState<{
    anchorRange: Range;
    comment: string;
    excerpt: string;
  } | null>(null);
  const copyResetTimeoutRef = useRef<number | null>(null);
  const hasCopyableUserText = message.role === "user" && Boolean(userBodyText.trim());
  const hasCopyableAssistantText = isAssistant && Boolean(assistantActions?.copyText.trim());
  const hasAssistantHandoff =
    hasCopyableAssistantText &&
    Boolean(assistantActions?.canHandoff && assistantActions.onHandoff);
  const hasUserMessageActions = hasCopyableUserText || isCollapsible;
  const userCopyLabel = resolveCopyLabel(copyState, "用户消息");
  const assistantCopyLabel = resolveCopyLabel(copyState, "回复");

  useEffect(() => () => {
    if (copyResetTimeoutRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(copyResetTimeoutRef.current);
    }
  }, []);

  function resetCopyStateAfter(delayMs: number) {
    if (typeof window === "undefined") {
      return;
    }
    if (copyResetTimeoutRef.current !== null) {
      window.clearTimeout(copyResetTimeoutRef.current);
    }
    copyResetTimeoutRef.current = window.setTimeout(() => {
      setCopyState("idle");
      copyResetTimeoutRef.current = null;
    }, delayMs);
  }

  async function copyMessageText(text: string) {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    try {
      await writeClipboardText(text, clipboard);
      setCopyState("copied");
      resetCopyStateAfter(1400);
    } catch {
      setCopyState("failed");
      resetCopyStateAfter(1800);
    }
  }

  async function copyUserMessage() {
    if (!hasCopyableUserText) {
      setCopyState("failed");
      resetCopyStateAfter(1800);
      return;
    }
    await copyMessageText(stripMissionPromptContext(message.text));
  }

  const [quoteSelection, setQuoteSelection] = useState<{
    anchorRange: Range;
    excerpt: string;
  } | null>(null);

  const articleRef = useRef<HTMLElement>(null);
  // 监听 document selectionchange 而非 onMouseUp:移动端触摸选择不会可靠触发 mouseup,
  // selectionchange 在鼠标拖选与触摸拖选下都会触发,配合防抖等选区稳定后再弹气泡。
  useEffect(() => {
    if (!onAddDraftContext || message.role === "system") {
      return;
    }
    let timer: number | null = null;
    const handleSelectionChange = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(() => {
        const article = articleRef.current;
        // 流式消息(DOM 仍在更新)禁用 quote 选区,避免 anchorRange 失效导致 popover 飘移。
        if (!article || article.closest('[data-streaming="true"]')) {
          return;
        }
        const selection = typeof window !== "undefined" ? window.getSelection() : null;
        const anchor = selection?.anchorNode;
        const focus = selection?.focusNode;
        if (
          !selection ||
          selection.rangeCount === 0 ||
          !anchor ||
          !focus ||
          !article.contains(anchor) ||
          !article.contains(focus)
        ) {
          return;
        }
        const normalized = normalizeQuotedSelection(selection.toString());
        if (!normalized) {
          setQuoteSelection(null);
          return;
        }
        setQuoteDraft(null);
        setQuoteSelection({
          anchorRange: selection.getRangeAt(0).cloneRange(),
          excerpt: normalized.excerpt,
        });
      }, 200);
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [onAddDraftContext, message.role]);

  function startQuoteDraft() {
    if (!quoteSelection) return;
    setQuoteDraft({ ...quoteSelection, comment: "" });
    setQuoteSelection(null);
    window.getSelection()?.removeAllRanges();
  }

  function clearQuoteInteraction() {
    setQuoteSelection(null);
    setQuoteDraft(null);
    window.getSelection()?.removeAllRanges();
  }

  async function copyAssistantMessage() {
    if (!hasCopyableAssistantText || !assistantActions) {
      setCopyState("failed");
      resetCopyStateAfter(1800);
      return;
    }
    await copyMessageText(assistantActions.copyText);
  }

  const quoteContainment = articleRef.current?.closest<HTMLElement>(
    '[data-mission-mobile-pane="chat"]',
  ) ?? undefined;

  return (
    <article
      className={cn(
        "plain-message min-w-0 text-foreground",
        `plain-${message.role}`,
        isStreaming && "plain-message-streaming",
        isSystem
          ? "mr-auto grid w-full max-w-full items-start"
          : isAssistant
            ? `${ASSISTANT_MESSAGE_FRAME_CLASS} grid ${ASSISTANT_MESSAGE_RAIL_CLASS} items-start`
            : "ml-auto grid w-full justify-items-end gap-2 text-left",
      )}
      data-streaming={isStreaming ? "true" : undefined}
      ref={articleRef}
    >
      {isAssistant ? (
        <span
          aria-hidden="true"
          className="plain-assistant-segment-marker flex min-h-5 justify-center pt-2"
        >
          <span className={cn(
            "plain-assistant-segment-dot size-1.5 rounded-full ring-2 ring-surface-sunken",
            isStreaming ? "animate-pulse bg-accent" : "bg-success",
          )} />
        </span>
      ) : null}
      <div
        className={cn(
          "grid min-w-0 gap-2",
          message.role === "user" && "w-full justify-items-end",
        )}
      >
        {message.role === "user" && message.attachments?.length ? (
          <div className="mission-message-attachments ml-auto flex w-fit max-w-full flex-wrap justify-end gap-2 justify-self-end">
            {message.attachments.map((image, index) => (
              <PlainMessageImageAttachment
                key={`${message.id}-image-${index}`}
                image={image}
                index={index}
                messageId={message.id}
                onPreview={setPreviewImage}
                tone="user"
              />
            ))}
          </div>
        ) : null}
        {message.role === "user" && userPromptContexts.length ? (
          <SentPromptContexts contexts={userPromptContexts} />
        ) : null}
        {isSystem ? (
          <div className="flex min-w-0 items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] leading-[1.5] text-foreground/80">
            <div className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">
              {renderPlainMessageContent(message, false, false)}
            </div>
            {onDismiss ? (
              <button
                type="button"
                className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-surface-sunken hover:text-foreground"
                onClick={() => onDismiss(message.id)}
                aria-label="关闭提示"
                title="关闭"
              >
                <Icon name="x" size={12} />
              </button>
            ) : null}
          </div>
        ) : message.role === "user" ? (
          <div className="plain-message-user-row flex w-full min-w-0 max-w-full items-start justify-end gap-1.5">
            <div
              className={cn(
                `${messageBodyClassName} ${USER_MESSAGE_RAIL_CLASS} min-w-0 break-words text-[12.5px] leading-[1.5] [overflow-wrap:anywhere]`,
                "rounded-[14px] border border-primary/30 bg-primary-soft/35 px-3 py-2 shadow-[0_10px_28px_rgb(0_0_0/0.16)]",
              )}
            >
              {renderPlainMessageContent(message, isCollapsible && !isExpanded, isStreaming)}
            </div>
          </div>
        ) : (
          <div
            className={cn(
              `${messageBodyClassName} min-w-0 max-w-full overflow-hidden text-[12.5px] leading-[1.5] [overflow-wrap:anywhere]`,
            )}
          >
            {renderPlainMessageContent(message, isCollapsible && !isExpanded, isStreaming)}
          </div>
        )}
        {quoteSelection ? (
          <SelectionCommentPopover
            anchor={quoteSelection.anchorRange}
            containment={quoteContainment}
            mode="actions"
            onCancel={clearQuoteInteraction}
            onOpenComposer={startQuoteDraft}
          />
        ) : null}
        {quoteDraft && onAddDraftContext ? (
          <SelectionCommentPopover
            anchor={quoteDraft.anchorRange}
            containment={quoteContainment}
            comment={quoteDraft.comment}
            context={(
              <span className="line-clamp-2 min-w-0">“{quoteDraft.excerpt}”</span>
            )}
            mode="composer"
            onCancel={clearQuoteInteraction}
            onChangeComment={(comment) => setQuoteDraft((current) => current
              ? { ...current, comment }
              : current)}
            onSubmit={() => {
              onAddDraftContext({
                id: `${message.id}:${quoteDraft.excerpt}`,
                kind: "quote",
                label: `${message.role} 引用`,
                comment: quoteDraft.comment.trim(),
                excerpt: quoteDraft.excerpt,
                source: { kind: "quote", messageId: message.id, role: message.role },
              });
              clearQuoteInteraction();
            }}
          />
        ) : null}
        {message.role === "user" && hasUserMessageActions ? (
          <div
            className={cn(
              "plain-message-actions flex flex-wrap items-center justify-end gap-1.5 justify-self-end",
              USER_MESSAGE_RAIL_CLASS,
            )}
          >
            {isCollapsible ? (
              <Button
                className="plain-message-expand w-fit px-3 py-1.5 text-xs"
                type="button"
                variant="outline"
                onClick={() => onToggleExpandedMessage(message.id)}
              >
                {isExpanded ? "收起消息" : "展开完整消息"}
              </Button>
            ) : null}
            {hasCopyableUserText ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="plain-message-copy shrink-0 text-muted-foreground opacity-70 hover:opacity-100"
                aria-label={userCopyLabel}
                title={userCopyLabel}
                onClick={copyUserMessage}
              >
                <Icon name={copyState === "copied" ? "check" : "copy"} size={12} />
              </Button>
            ) : null}
          </div>
        ) : null}
        {message.role !== "user" && message.attachments?.length ? (
          <div className="mission-message-attachments flex max-w-full flex-wrap justify-start gap-2">
            {message.attachments.map((image, index) => (
              <PlainMessageImageAttachment
                key={`${message.id}-image-${index}`}
                image={image}
                index={index}
                messageId={message.id}
                onPreview={setPreviewImage}
                tone="assistant"
              />
            ))}
          </div>
        ) : null}
        {hasCopyableAssistantText ? (
          <div className="plain-assistant-actions mt-0.5 flex max-w-full items-center gap-1 border-t border-border-ghost/70 pt-1.5 text-muted-foreground">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="plain-assistant-copy shrink-0 text-muted-foreground opacity-70 hover:opacity-100"
              aria-label={assistantCopyLabel}
              title={assistantCopyLabel}
              onClick={copyAssistantMessage}
            >
              <Icon name={copyState === "copied" ? "check" : "copy"} size={12} />
            </Button>
            {hasAssistantHandoff ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="plain-assistant-handoff shrink-0 text-muted-foreground opacity-70 hover:opacity-100"
                aria-label={
                  assistantActions?.handoffBusy
                    ? "正在生成 Handoff"
                    : "生成 Handoff"
                }
                title={
                  assistantActions?.handoffBusy
                    ? "正在生成 Handoff"
                    : "生成 Handoff"
                }
                disabled={assistantActions?.handoffBusy}
                onClick={() => assistantActions?.onHandoff?.(assistantActions.copyText)}
              >
                <Icon name="handoff" size={12} />
              </Button>
            ) : null}
          </div>
        ) : null}
        {previewImage ? (
          <PlainMessageImageLightbox
            image={previewImage}
            onClose={() => setPreviewImage(null)}
          />
        ) : null}
      </div>
    </article>
  );
});

export async function writeClipboardText(
  text: string,
  clipboard: Pick<Clipboard, "writeText"> | undefined,
) {
  await copyTextToClipboard(text, clipboard);
}

function resolveCopyLabel(
  state: "idle" | "copied" | "failed",
  targetLabel: string,
) {
  if (state === "copied") {
    return `已复制${targetLabel}`;
  }
  if (state === "failed") {
    return `复制${targetLabel}失败`;
  }
  return `复制${targetLabel}`;
}

function PlainThinkingIcon() {
  return (
    <svg
      className="plain-thinking-icon size-3"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M5.6 11.4c-1.8 0-3.2-1.3-3.2-3 0-1.4.9-2.5 2.2-2.9.3-1.7 1.8-3 3.6-3 1.5 0 2.8.9 3.4 2.2 1.2.3 2.1 1.4 2.1 2.7 0 1.6-1.3 2.9-3 2.9H8.8L6.6 13v-1.6h-1Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.4 6.4h3.4M5.9 8.3h4.2"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PlainThinkingItem({
  items,
  hasNewerContent = false,
}: {
  items: SessionTimelineThinkingChunk[];
  hasNewerContent?: boolean;
}) {
  const thinkingItems = items.length > 0 ? items : [{
    id: "empty-thinking",
    kind: "thinking" as const,
    text: "",
    title: "Thinking",
    status: "completed" as const,
    timestamp: "",
    updatedAt: "",
  }];
  const text = thinkingItems
    .map((item) => item.text.trim() || "暂无 Thinking 内容")
    .join("\n\n");
  const latestThinkingItem = thinkingItems.at(-1);
  const isRunning = latestThinkingItem?.status === "pending" ||
    latestThinkingItem?.status === "running";
  // The first line is still incomplete while a thought is streaming. Keep the
  // summary label stable until the provider publishes a terminal snapshot.
  const preview = isRunning ? "" : resolveThinkingSummaryPreview(text);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowStreamRef = useRef(true);
  const contentClassName = resolveThinkingContentClassName({
    isRunning,
    text,
  });
  // Thinking 缺乏可靠的完成事件（status 可能长期停留在 running），因此一旦其后出现新内容即视为已结束并折叠。
  const shouldAutoOpen = isRunning && !hasNewerContent;
  const [open, setOpen] = useState(shouldAutoOpen);

  useEffect(() => {
    setOpen(shouldAutoOpen);
  }, [shouldAutoOpen]);

  useEffect(() => {
    if (!open) {
      shouldFollowStreamRef.current = true;
    }
  }, [open]);

  useEffect(() => {
    if (!open || !isRunning || !shouldFollowStreamRef.current) {
      return;
    }
    const content = contentRef.current;
    if (!content) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      content.scrollTop = content.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [isRunning, open, text]);

  function handleThinkingScroll(event: UIEvent<HTMLDivElement>) {
    shouldFollowStreamRef.current = isThinkingScrollNearBottom({
      scrollTop: event.currentTarget.scrollTop,
      clientHeight: event.currentTarget.clientHeight,
      scrollHeight: event.currentTarget.scrollHeight,
    });
  }

  return (
    <div className={`plain-thinking-row ${ASSISTANT_MESSAGE_FRAME_CLASS} grid ${ASSISTANT_MESSAGE_RAIL_CLASS} items-start text-muted-foreground`}>
      <span aria-hidden="true" />
      <details
        className="plain-thinking min-w-0 w-full rounded-[8px] border border-border-ghost bg-surface-sunken/55 px-2 py-1 text-muted-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]"
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary
          className="flex w-full cursor-pointer list-none items-center gap-2 rounded-sm py-0.5 text-xs leading-4 text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-border-ghost [&::-webkit-details-marker]:hidden"
          aria-label={open ? "收起 Thinking" : "展开 Thinking"}
        >
          <span
            aria-hidden="true"
            className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm bg-violet-500/10 text-violet-700 dark:bg-violet-300/10 dark:text-violet-300"
          >
            <PlainThinkingIcon />
          </span>
          <span className="inline-flex h-4 shrink-0 items-center whitespace-nowrap font-medium text-violet-700 dark:text-violet-300">
            Thinking
          </span>
          {preview ? (
            <span className="inline-flex h-4 min-w-0 flex-1 items-center truncate leading-none text-muted-foreground/70">
              {preview}
            </span>
          ) : null}
          <Icon
            name="chevronDown"
            size={12}
            className={cn(
              "ml-auto text-muted-foreground/60 transition-transform duration-150",
              open && "rotate-180",
            )}
          />
        </summary>
        {open ? (
          <div ref={contentRef} className={contentClassName} onScroll={handleThinkingScroll}>
            <div className={cn(
              "plain-thinking-parts min-w-0",
              thinkingItems.length > 1 && "divide-y divide-border-ghost/70",
            )}>
              {thinkingItems.map((item, index) => (
                <div
                  key={`${item.id}-${index}`}
                  className="plain-thinking-text whitespace-pre-wrap py-1 [overflow-wrap:anywhere]"
                >
                  {item.text.trim() || "暂无 Thinking 内容"}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </details>
    </div>
  );
}

export function resolveThinkingContentClassName(
  input: { isRunning: boolean; text: string },
) {
  const shouldLimitHeight = shouldLimitThinkingHeight(input.text);
  return cn(
    "plain-thinking-content pt-1 pr-1 text-[12.5px] leading-[1.5] overflow-y-auto overscroll-contain text-muted-foreground [overflow-wrap:anywhere] [scrollbar-gutter:stable] [overflow-anchor:none]",
    shouldLimitHeight ? "max-h-64" : undefined,
  );
}

function shouldLimitThinkingHeight(text: string) {
  const lineCount = text.split(/\r?\n/u).length;
  return lineCount > THINKING_SCROLL_LINE_THRESHOLD ||
    text.length > THINKING_SCROLL_CHAR_THRESHOLD;
}

function resolveThinkingSummaryPreview(text: string) {
  const firstMeaningfulLine = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstMeaningfulLine) {
    return "";
  }
  return firstMeaningfulLine.length <= THINKING_SUMMARY_PREVIEW_MAX_CHARS
    ? firstMeaningfulLine
    : `${firstMeaningfulLine.slice(0, THINKING_SUMMARY_PREVIEW_MAX_CHARS - 1)}…`;
}

export function isThinkingScrollNearBottom(
  metrics: { scrollTop: number; clientHeight: number; scrollHeight: number },
  threshold = 24,
) {
  return metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop <= threshold;
}

type PlainToolGroupItemProps = {
  group: ConversationToolCallItem[];
  hasNewerContent?: boolean;
};

function areToolGroupPropsEqual(
  prev: PlainToolGroupItemProps,
  next: PlainToolGroupItemProps,
) {
  if (prev.hasNewerContent !== next.hasNewerContent) return false;
  if (prev.group.length !== next.group.length) return false;
  for (let i = 0; i < prev.group.length; i++) {
    const a = prev.group[i]!;
    const b = next.group[i]!;
    if (
      a.id !== b.id ||
      a.title !== b.title ||
      a.status !== b.status ||
      a.toolKind !== b.toolKind ||
      a.text !== b.text ||
      a.input !== b.input
    ) return false;
  }
  return true;
}

export const PlainToolGroupItem = memo(function PlainToolGroupItem({
  group,
  hasNewerContent = false,
}: PlainToolGroupItemProps) {
  const isRunning = group.some((item) => isActiveToolStatus(item.status));
  const [open, setOpen] = useState(() => isRunning || !hasNewerContent);
  const groupLabels = resolveToolGroupLabels(group);
  const summaryTitle = summarizeToolGroupTitle(groupLabels);
  const groupBadgeLabel = resolveToolGroupBadgeLabel(groupLabels);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isRunning) {
      setOpen(true);
      return;
    }
    if (hasNewerContent) {
      setOpen(false);
    }
  }, [hasNewerContent, isRunning]);

  // 自动滚动到底部：当工具组打开且有新工具调用时
  useEffect(() => {
    if (!open) {
      return;
    }
    const content = contentRef.current;
    if (!content) {
      return;
    }

    const scrollToBottom = () => {
      content.scrollTop = content.scrollHeight;
    };

    // 使用 requestAnimationFrame 确保 DOM 更新后滚动
    // 双重 rAF 确保布局和渲染都完成
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(scrollToBottom);
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [group.length, open]);

  return (
    <div className={`plain-tool-row ${ASSISTANT_MESSAGE_FRAME_CLASS} grid ${ASSISTANT_MESSAGE_RAIL_CLASS} items-start text-muted-foreground`}>
      <span aria-hidden="true" />
      <details
        className="plain-tool-group min-w-0 w-full rounded-[8px] border border-border-ghost bg-surface-sunken/55 px-2 py-1 text-muted-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]"
        data-tool-group-kind={groupBadgeLabel.toLowerCase()}
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary
          className="flex w-full cursor-pointer list-none items-center gap-2 rounded-sm py-0.5 text-xs leading-4 text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-border-ghost [&::-webkit-details-marker]:hidden"
          aria-label={open ? "收起工具调用" : "展开工具调用"}
        >
          <span
            aria-hidden="true"
            className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm bg-sky-500/10 text-sky-700 dark:bg-sky-300/10 dark:text-sky-300"
          >
            <Icon name="hammer" size={12} />
          </span>
          <span className="inline-flex h-4 shrink-0 items-center whitespace-nowrap font-medium leading-none text-sky-700 dark:text-sky-300">
            工具调用 · {group.length} 项
          </span>
          <span className="min-w-0 truncate text-muted-foreground/70">
            {summaryTitle}
          </span>
          {isRunning ? (
            <span className="ml-auto shrink-0 rounded-sm bg-accent/10 px-1.5 py-0.5 text-2xs font-semibold text-accent">
              运行中
            </span>
          ) : null}
          <Icon
            name="chevronDown"
            size={12}
            className={cn(
              "text-muted-foreground/60 transition-transform duration-150",
              isRunning ? "ml-1.5" : "ml-auto",
              open && "rotate-180",
            )}
          />
        </summary>
        <div
          ref={contentRef}
          className="plain-tool-group-content flex max-h-[min(22rem,55vh)] min-w-0 flex-col divide-y divide-border-ghost/70 overflow-y-auto pr-1 text-[12.5px] text-muted-foreground [&::-webkit-scrollbar-button]:hidden"
          data-mission-swipe-lock="true"
        >
          {group.map((item) => (
            <PlainToolCallItem
              key={item.id}
              item={item}
            />
          ))}
        </div>
      </details>
    </div>
  );
}, areToolGroupPropsEqual)

export function PlainSubagentItem({
  item,
  hasNewerContent = false,
  detail,
  detailContent,
  onToggleDetail,
}: {
  item: ConversationToolCallItem;
  hasNewerContent?: boolean;
  detail?: SessionSubagentDetail & { loading?: boolean; failed?: boolean };
  detailContent?: ReactNode;
  onToggleDetail?: (open: boolean) => void;
}) {
  const codexPresentation = resolveCodexSubagentPresentation(item);
  const isRunning = isActiveToolStatus(item.status);
  const shouldAutoOpen = isRunning && !hasNewerContent;
  const [open, setOpen] = useState(shouldAutoOpen);
  const lastDetailOpenRef = useRef<boolean | undefined>(undefined);
  const fallbackText = codexPresentation?.text ||
    resolveSubagentOutput(item.text) ||
    resolveSubagentPrompt(item.input) ||
    "暂无 Subagent 内容";
  const summary = codexPresentation?.summary ?? resolveSubagentSummary(item);
  const label = codexPresentation?.label ?? resolveSubagentLabel(item);
  const statusBadge = codexPresentation?.statusBadge ?? resolveSubagentStatusBadge(item);

  useEffect(() => {
    setOpen(shouldAutoOpen);
  }, [shouldAutoOpen]);

  useEffect(() => {
    if (lastDetailOpenRef.current === undefined && !open) {
      lastDetailOpenRef.current = false;
      return;
    }
    if (lastDetailOpenRef.current === open) return;
    lastDetailOpenRef.current = open;
    onToggleDetail?.(open);
  }, [onToggleDetail, open]);

  const hasDetail = (detail?.entries.length ?? 0) > 0;
  const isDetailLoading = Boolean(onToggleDetail && (!detail || detail.loading)) && !hasDetail;

  return (
    <div className={`plain-subagent-row ${ASSISTANT_MESSAGE_FRAME_CLASS} grid ${ASSISTANT_MESSAGE_RAIL_CLASS} items-start text-muted-foreground`}>
      <span aria-hidden="true" />
      <details
        className="plain-subagent min-w-0 w-full rounded-[8px] border border-border-ghost bg-surface-sunken/55 px-2 py-1 text-muted-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]"
        data-subagent-call
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary
          className="flex min-w-0 w-full cursor-pointer list-none items-center gap-2 rounded-sm py-1 text-xs leading-4 text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-border-ghost [&::-webkit-details-marker]:hidden"
          aria-label={open ? `收起 ${label}` : `展开 ${label}`}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm bg-amber-500/10 text-amber-700 dark:bg-amber-300/10 dark:text-amber-300">
              <Icon name="message" size={12} className="shrink-0" />
            </span>
            <span
              className="inline-flex h-4 min-w-0 flex-1 items-center truncate font-medium leading-none text-amber-700 dark:text-amber-300"
              title={label}
            >
              {label}
            </span>
            {summary ? (
              <span
                className="inline-flex h-4 min-w-0 max-w-[45%] shrink items-center truncate leading-none text-muted-foreground/70"
                title={summary}
              >
                {summary}
              </span>
            ) : null}
          </span>
          {statusBadge ? (
            <span className={cn("inline-flex h-4 shrink-0 items-center rounded-sm px-1.5 py-0.5 text-2xs font-semibold leading-none", statusBadge.className)}>
              {statusBadge.label}
            </span>
          ) : null}
          <span
            className={cn(
              "inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground/60 transition-transform duration-150",
              open && "rotate-180",
            )}
          >
            <Icon name="chevronDown" size={12} />
          </span>
        </summary>
        <div
          className="plain-subagent-content max-h-[min(22rem,55vh)] min-w-0 overflow-y-auto overscroll-contain pr-1 pt-1 text-[12.5px] leading-[1.5] text-muted-foreground [overflow-wrap:anywhere] [scrollbar-gutter:stable] [&::-webkit-scrollbar-button]:hidden [&_.markdown-message]:text-muted-foreground [&_.markdown-paragraph]:text-muted-foreground"
          data-mission-swipe-lock="true"
        >
          {hasDetail ? (
            detailContent
          ) : isDetailLoading ? (
            <span className="text-muted-foreground/70">正在加载 Subagent 会话…</span>
          ) : detail?.failed ? (
            <span className="text-muted-foreground/70">Subagent 会话加载失败，收起后可重试</span>
          ) : (
            <MarkdownMessage text={fallbackText} />
          )}
        </div>
      </details>
    </div>
  );
}

function resolveSubagentPrompt(input: string) {
  const metadata = parseSubagentMetadata(input);
  return metadata.prompt ?? metadata.description ?? formatToolInputPreview(input);
}

function resolveSubagentLabel(item: ConversationToolCallItem) {
  const metadata = parseSubagentMetadata(item.input);
  if (metadata.name) {
    return metadata.name;
  }
  const title = item.title.trim();
  if (title && !/^(call[_-]|tool[_-]|Tool call\b)/iu.test(title)) {
    return title;
  }
  return "Subagent";
}

function resolveSubagentSummary(item: ConversationToolCallItem) {
  const metadata = parseSubagentMetadata(item.input);
  if (isBackgroundCancelSubagent(item)) {
    return "取消后台任务";
  }
  if (metadata.description) {
    return metadata.description;
  }
  if (item.status === "failed") {
    return "Error";
  }
  const title = item.title.trim();
  if (title && !/^(call[_-]|tool[_-]|Tool call\b)/iu.test(title)) {
    return title;
  }
  return "";
}

function resolveSubagentStatusBadge(item: ConversationToolCallItem) {
  if (item.status === "failed") {
    return {
      className: "bg-danger-soft text-danger",
      label: "错误",
    };
  }
  if (item.status === "cancelled" || isBackgroundCancelSubagent(item)) {
    return {
      className: "bg-surface-sunken text-muted-foreground",
      label: "已取消",
    };
  }
  if (item.status === "completed") {
    return {
      className: "bg-success/10 text-success",
      label: "已完成",
    };
  }
  if (isActiveToolStatus(item.status)) {
    return {
      className: "bg-accent/10 text-accent",
      label: "运行中",
    };
  }
  return null;
}

function resolveSubagentOutput(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  const parsed = parseJsonRecord(trimmed);
  const output = typeof parsed?.output === "string" ? parsed.output : trimmed;
  const taskOutput = output.match(/<output>\s*([\s\S]*?)\s*<\/output>/iu)?.[1]?.trim();
  if (taskOutput) {
    return taskOutput;
  }
  if (/<(?:retrieval_status|task_id|task_type|status)>/iu.test(output)) {
    return "";
  }
  return output
    .replace(/^Task completed in [^\r\n]+(?:\r?\n)+(?:Agent:[^\r\n]+(?:\r?\n)+)?---(?:\r?\n)+/iu, "")
    .replace(/\r?\n?<!--\s*OMO_INTERNAL_INITIATOR\s*-->/giu, "")
    .replace(/\r?\n*<task_metadata>[\s\S]*?<\/task_metadata>/giu, "")
    .replace(/\r?\n*to continue:\s*task\([\s\S]*$/iu, "")
    .replace(/(?:^|\r?\n)agentId:\s*\S+\s+\(use SendMessage[\s\S]*$/iu, "")
    .replace(/(?:^|\r?\n)<usage>[\s\S]*?<\/usage>/giu, "")
    .replace(/^\(Subagent completed but returned no output\.\)$/iu, "")
    .trim();
}

function isBackgroundCancelSubagent(item: ConversationToolCallItem) {
  return item.title.trim().toLowerCase() === "background_cancel";
}

function isOpaqueSubagentTitle(title: string) {
  return /^(call[_-]|tool[_-])/iu.test(title.trim());
}

function parseSubagentMetadata(input: string) {
  const parsed = parseJsonRecord(input);
  if (!parsed) {
    return {};
  }
  const candidates = [
    parsed,
    recordFrom(parsed.arguments),
    recordFrom(parsed.args),
    recordFrom(parsed.params),
    recordFrom(parsed.input),
  ].filter((record): record is Record<string, unknown> => Boolean(record));
  for (const record of candidates) {
    const name = firstString(record, [
      "subagent_type",
      "subagentType",
      "agent_type",
      "agentType",
      "agent_name",
      "agentName",
      "agent",
      "name",
      "label",
    ]);
    const prompt = firstString(record, [
      "prompt",
      "message",
      "query",
      "instructions",
      "task",
    ]);
    const description = firstString(record, [
      "description",
      "task",
      "prompt",
      "query",
      "message",
      "instructions",
    ]);
    if (name || description || prompt) {
      return { name, description, prompt };
    }
  }
  return {};
}

function parseJsonRecord(input: string) {
  const trimmed = input.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  try {
    return recordFrom(JSON.parse(trimmed) as unknown);
  } catch {
    return null;
  }
}

function recordFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

type PlainToolCallItemProps = {
  item: ConversationToolCallItem;
};

export const PlainToolCallItem = memo(function PlainToolCallItem({
  item,
}: PlainToolCallItemProps) {
  const tone = resolveToolCallTone(item.toolKind, item.title);
  const preview = item.text.trim() || formatToolInputPreview(item.input);
  const displayTitle = resolveToolCallDisplayTitle(tone.label, item.title);
  const changeStats = resolveToolCallChangeStats(
    item.toolKind,
    item.input,
    item.text,
  );
  const diff = changeStats
    ? resolveToolCallDiff(item.toolKind, item.input, item.text)
    : undefined;
  return (
    <details
      className="plain-tool-call min-w-0 text-muted-foreground"
      data-tool-kind={tone.label.toLowerCase()}
    >
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-1.5 py-0.5 text-2xs leading-4 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className={cn("grid size-3 shrink-0 place-items-center rounded-sm", tone.className)}>
          <Icon name={resolveToolCallIconName(tone.label)} size={9} />
        </span>
        <span className={cn("inline-flex shrink-0 items-center", TOOL_CATEGORY_SLOT_CLASS_NAME)}>
          <Badge
            variant="secondary"
            className={cn("inline-flex h-4 shrink-0 items-center rounded-sm px-1.5 py-0 text-[10px] font-semibold leading-none", tone.className)}
          >
            {tone.label}
          </Badge>
        </span>
        <strong
          className="min-w-0 flex-1 truncate font-medium leading-4 text-foreground"
          title={displayTitle}
        >
          {displayTitle}
        </strong>
        {changeStats ? (
          <span
            aria-label={`修改统计：新增 ${changeStats.additions} 行，删除 ${changeStats.deletions} 行`}
            className="inline-flex shrink-0 items-center gap-1 font-mono text-2xs tabular-nums"
          >
            <span className={cn("tool-call-additions", resolveToolCallStatClass(changeStats.additions, "additions"))}>+{changeStats.additions}</span>
            <span className="text-muted-foreground/50">/</span>
            <span className={cn("tool-call-deletions", resolveToolCallStatClass(changeStats.deletions, "deletions"))}>-{changeStats.deletions}</span>
          </span>
        ) : null}
        <span className="inline-flex h-4 shrink-0 items-center text-2xs text-muted-foreground/60">
          {resolveToolStatusLabel(item.status)}
        </span>
      </summary>
      {changeStats ? (
        <ToolCallDiffPreview
          diff={diff}
        />
      ) : preview ? (
        <pre className="mt-0.5 min-w-0 w-full max-w-full max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-snug text-muted-foreground/85" data-mission-swipe-lock="true">
          {preview}
        </pre>
      ) : null}
    </details>
  );
}, arePlainToolCallItemPropsEqual);

function arePlainToolCallItemPropsEqual(
  previous: PlainToolCallItemProps,
  next: PlainToolCallItemProps,
) {
  const previousItem = previous.item;
  const nextItem = next.item;
  return previousItem.id === nextItem.id &&
    previousItem.title === nextItem.title &&
    previousItem.status === nextItem.status &&
    previousItem.toolKind === nextItem.toolKind &&
    previousItem.text === nextItem.text &&
    previousItem.input === nextItem.input &&
    previousItem.streams.length === nextItem.streams.length &&
    previousItem.streams.every((stream, index) => stream === nextItem.streams[index]);
}

export function resolveToolCallDisplayTitle(label: string, title: string) {
  if (label === "Skill") {
    return title.replace(/^Skill:\s*/iu, "").trim() || "Skill";
  }
  if (label === "MCP") {
    return title.replace(/^Tool:\s*/iu, "").trim() || "MCP";
  }
  if (label === "Diagnostics") {
    return title.replace(/^Diagnostics(?:\s*:)?\s*/iu, "").trim() || "Diagnostics";
  }
  return title;
}

function resolveToolCallStatClass(
  value: number,
  kind: "additions" | "deletions",
) {
  if (value === 0) {
    return "text-muted-foreground/60";
  }
  return kind === "additions" ? "text-success" : "text-destructive";
}

function resolveToolGroupBadgeLabel(labels: string[]): string {
  return labels[0] ?? "Tool";
}

function resolveToolGroupLabels(group: ConversationToolCallItem[]) {
  const labels = group.map((item) => resolveToolCallTone(item.toolKind, item.title).label);
  return Array.from(new Set(labels));
}

function summarizeToolGroupTitle(labels: string[]) {
  return labels.slice(0, 3).join(" / ");
}

function SentPromptContexts({ contexts }: { contexts: MissionPromptContextItem[] }) {
  return (
    <div
      className="mission-message-attachments ml-auto flex w-full max-w-[min(56rem,76%)] flex-wrap justify-end gap-2 justify-self-end"
      data-prompt-context-boundary="message"
      aria-label="已发送评论"
    >
      <PromptContextMenu
        contexts={contexts}
        align="end"
        resolveTitle={resolveReviewContextTitle}
      />
    </div>
  );
}

function renderPlainMessageContent(
  message: AgentMessage,
  collapsed: boolean,
  streaming = false,
) {
  if (message.role === "user") {
    const parsed = parseMissionPromptContext(message.text);
    return (
      <div
        className={
          collapsed ? "plain-message-text plain-message-text-collapsed line-clamp-3 overflow-hidden whitespace-pre-wrap" : "plain-message-text whitespace-pre-wrap"
        }
      >
        {parsed.body}
      </div>
    );
  }

  if (streaming) {
    const segmented = splitStreamingMarkdown(message.text);
    if (!segmented) {
      return <PlainStreamingText text={message.text} />;
    }
    return (
      <>
        <div
          className="min-w-0 [&_.markdown-table-scroll]:max-w-full [&_.markdown-table-scroll]:overflow-x-auto [&_.markdown-table-scroll]:overflow-y-hidden"
          data-mission-swipe-lock="true"
        >
          <MarkdownMessage
            text={segmented.markdown}
            renderMermaid={false}
            plainCodeBlocks
          />
        </div>
        {segmented.tail ? <PlainStreamingText text={segmented.tail} tail /> : null}
      </>
    );
  }

  return (
    <div
      className="min-w-0 [&_.markdown-table-scroll]:max-w-full [&_.markdown-table-scroll]:overflow-x-auto [&_.markdown-table-scroll]:overflow-y-hidden"
      data-mission-swipe-lock="true"
    >
      <MarkdownMessage text={message.text} repairMalformedTables />
    </div>
  );
}

type PlainStreamingTextProps = {
  tail?: boolean;
  text: string;
};

function PlainStreamingText({ tail = false, text }: PlainStreamingTextProps) {
  return (
    <div
      className={cn(
        "plain-message-text whitespace-pre-wrap",
        tail && "plain-message-streaming-tail",
      )}
    >
      {text}
    </div>
  );
}
