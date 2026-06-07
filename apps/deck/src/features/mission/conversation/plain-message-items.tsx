import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AgentMessage, AgentPromptImageContent, AgentToolCall } from "@tiller/shared";
import { DAEMON_HOST_KEY, DAEMON_PORT_KEY } from "../../helm-connection/helm-endpoint";
import { Badge, Button, Icon } from "../../../shared/ui";
import { MarkdownMessage } from "../../../shared/ui/markdown";
import type { ConversationToolCallItem } from "../../logbook";
import { resolveToolCallTone } from "../../logbook/tool-call-tone";
import { cn } from "../../../shared/utils/cn";
import {
  formatToolInputPreview,
  isActiveToolStatus,
  resolveToolCallIconName,
  resolveToolStatusLabel,
} from "./plain-tool-model";
import { splitStreamingMarkdown } from "./streaming-markdown";

const COLLAPSED_MESSAGE_LINE_LIMIT = 3;
const COLLAPSED_MESSAGE_CHAR_LIMIT = 300;
const DEFAULT_ATTACHMENT_HOST = "127.0.0.1";
const DEFAULT_ATTACHMENT_PORT = "47631";

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
  const lineCount = text.split(/\r?\n/).length;
  return (
    lineCount > COLLAPSED_MESSAGE_LINE_LIMIT ||
    text.length > COLLAPSED_MESSAGE_CHAR_LIMIT
  );
}

type PlainMessageItemProps = {
  isContinuation: boolean;
  isExpanded: boolean;
  message: AgentMessage;
  onToggleExpandedMessage: (messageId: string) => void;
  roleLabel: string;
};

export const PlainMessageItem = memo(function PlainMessageItem({
  isContinuation,
  isExpanded,
  message,
  onToggleExpandedMessage,
  roleLabel,
}: PlainMessageItemProps) {
  const isAssistant = message.role === "assistant";
  const isStreaming = isAssistant && message.streaming;
  const isCollapsible =
    message.role === "user" && shouldCollapsePlainMessage(message.text);
  const messageBodyClassName =
    isCollapsible && !isExpanded
      ? "plain-message-body plain-message-body-collapsed"
      : "plain-message-body";
  const [previewImage, setPreviewImage] = useState<PlainMessageImagePreview | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyResetTimeoutRef = useRef<number | null>(null);
  const hasCopyableUserText = message.role === "user" && Boolean(message.text.trim());
  const hasUserMessageActions = hasCopyableUserText || isCollapsible;
  const copyLabel = copyState === "copied"
    ? "已复制用户消息"
    : copyState === "failed"
      ? "复制用户消息失败"
      : "复制用户消息";

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

  async function copyUserMessage() {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!hasCopyableUserText || !clipboard?.writeText) {
      setCopyState("failed");
      resetCopyStateAfter(1800);
      return;
    }
    try {
      await clipboard.writeText(message.text);
      setCopyState("copied");
      resetCopyStateAfter(1400);
    } catch {
      setCopyState("failed");
      resetCopyStateAfter(1800);
    }
  }

  return (
    <article
      className={cn(
        "plain-message min-w-0 text-foreground",
        `plain-${message.role}`,
        isStreaming && "plain-message-streaming",
        isAssistant
          ? "mr-auto grid w-full max-w-full grid-cols-[0.75rem_minmax(0,1fr)] items-start gap-x-2.5"
          : "ml-auto grid w-full justify-items-end gap-2 text-left",
      )}
      data-streaming={isStreaming ? "true" : undefined}
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
        {message.role === "user" ? null : (
          <span
            className={cn(
              "plain-message-role text-xs font-semibold uppercase tracking-wider text-muted-foreground",
              isContinuation && "sr-only",
            )}
          >
            {roleLabel}
          </span>
        )}
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
        {message.role === "user" ? (
          <div className="plain-message-user-row flex max-w-full items-start justify-end gap-1.5">
            <div
              className={cn(
                `${messageBodyClassName} min-w-14 w-fit break-words text-[12.5px] leading-[1.5]`,
                "max-w-[min(680px,61.8%)] rounded-[14px] border border-primary/20 bg-primary-soft/25 px-3 py-2 shadow-[0_8px_24px_rgb(0_0_0/0.12)]",
              )}
            >
              {renderPlainMessageContent(message, isCollapsible && !isExpanded, isStreaming)}
            </div>
          </div>
        ) : (
          <div
            className={cn(
              `${messageBodyClassName} min-w-0 text-[12.5px] leading-[1.5] [overflow-wrap:anywhere]`,
            )}
          >
            {renderPlainMessageContent(message, isCollapsible && !isExpanded, isStreaming)}
          </div>
        )}
        {message.role === "user" && hasUserMessageActions ? (
          <div className="plain-message-actions flex max-w-[min(680px,61.8%)] flex-wrap items-center justify-end gap-1.5 justify-self-end">
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
                aria-label={copyLabel}
                title={copyLabel}
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
  item,
  hasNewerContent = false,
}: {
  item: AgentToolCall;
  hasNewerContent?: boolean;
}) {
  const isRunning = item.status === "pending" || item.status === "running";
  const text = item.output?.trim() || item.input?.trim() || "暂无 Thinking 内容";
  // Thinking 缺乏可靠的完成事件（status 可能长期停留在 running），因此一旦其后出现新内容即视为已结束并折叠。
  const shouldAutoOpen = isRunning && !hasNewerContent;
  const [open, setOpen] = useState(shouldAutoOpen);

  useEffect(() => {
    setOpen(shouldAutoOpen);
  }, [shouldAutoOpen]);

  return (
    <div className="plain-thinking-row mr-auto grid w-full max-w-full grid-cols-[0.75rem_minmax(0,1fr)] items-start gap-x-2.5 text-muted-foreground">
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
          <span aria-hidden="true" className="shrink-0 text-primary">
            <PlainThinkingIcon />
          </span>
          <span className="min-w-0 truncate font-medium">
            Thinking
          </span>
          <Icon
            name="chevronDown"
            size={12}
            className={cn(
              "ml-auto text-muted-foreground/60 transition-transform duration-150",
              open && "rotate-180",
            )}
          />
        </summary>
        <div className="plain-thinking-content ml-1.5 border-l border-primary/25 pl-3.5 text-[12.5px] leading-[1.5] text-muted-foreground [overflow-wrap:anywhere] [&_.markdown-message]:text-muted-foreground [&_.markdown-paragraph]:text-muted-foreground">
          <MarkdownMessage text={text} />
        </div>
      </details>
    </div>
  );
}

export function PlainToolGroupItem({
  group,
  hasNewerContent = false,
}: {
  group: ConversationToolCallItem[];
  hasNewerContent?: boolean;
}) {
  const isRunning = group.some((item) => isActiveToolStatus(item.status));
  const [open, setOpen] = useState(() => isRunning || !hasNewerContent);
  const groupLabels = resolveToolGroupLabels(group);
  const summaryTitle = summarizeToolGroupTitle(groupLabels);
  const groupBadgeLabel = resolveToolGroupBadgeLabel(groupLabels);

  useEffect(() => {
    if (isRunning) {
      setOpen(true);
      return;
    }
    if (hasNewerContent) {
      setOpen(false);
    }
  }, [hasNewerContent, isRunning]);

  return (
    <div className="plain-tool-row mr-auto grid w-full max-w-full grid-cols-[0.75rem_minmax(0,1fr)] items-start gap-x-2.5 text-muted-foreground">
      <span aria-hidden="true" />
      <details
        className="plain-tool-group min-w-0 w-full rounded-[8px] border border-border-ghost bg-surface-sunken/55 px-2 py-1 text-muted-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]"
        data-tool-group-kind={groupBadgeLabel.toLowerCase()}
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary
          className="flex w-full cursor-pointer list-none items-center gap-1.5 rounded-sm py-0.5 text-xs leading-4 text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-border-ghost [&::-webkit-details-marker]:hidden"
          aria-label={open ? "收起工具调用" : "展开工具调用"}
        >
          <Icon name="hammer" size={12} className="text-primary" />
          <span className="whitespace-nowrap font-medium text-muted-foreground">
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
        <div className="plain-tool-group-content ml-1.5 grid max-h-36 gap-1 overflow-y-auto border-l border-primary/25 pl-3.5 pr-1 text-[12.5px] text-muted-foreground" data-mission-swipe-lock="true">
          {group.map((item) => (
            <PlainToolCallItem key={item.id} item={item} />
          ))}
        </div>
      </details>
    </div>
  );
}

export function PlainSubagentItem({
  item,
  hasNewerContent = false,
}: {
  item: ConversationToolCallItem;
  hasNewerContent?: boolean;
}) {
  const isRunning = isActiveToolStatus(item.status);
  const shouldAutoOpen = isRunning && !hasNewerContent;
  const [open, setOpen] = useState(shouldAutoOpen);
  const text = item.text.trim() || formatToolInputPreview(item.input) || "暂无 Subagent 内容";
  const summary = resolveSubagentSummary(item);
  const statusBadge = resolveSubagentStatusBadge(item);

  useEffect(() => {
    setOpen(shouldAutoOpen);
  }, [shouldAutoOpen]);

  return (
    <div className="plain-subagent-row mr-auto grid w-full max-w-full grid-cols-[0.75rem_minmax(0,1fr)] items-start gap-x-2.5 text-muted-foreground">
      <span aria-hidden="true" />
      <details
        className="plain-subagent min-w-0 w-full rounded-[8px] border border-border-ghost bg-surface-sunken/55 px-2 py-1 text-muted-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]"
        data-subagent-call
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary
          className="flex w-full cursor-pointer list-none items-center gap-2 rounded-sm py-0.5 text-xs leading-4 text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-border-ghost [&::-webkit-details-marker]:hidden"
          aria-label={open ? "收起 Subagent" : "展开 Subagent"}
        >
          <Icon name="message" size={12} className="shrink-0 text-primary" />
          <span className="shrink-0 font-medium">
            Subagent
          </span>
          <span className="min-w-0 truncate text-muted-foreground/70">
            {summary}
          </span>
          {statusBadge ? (
            <span className={cn("ml-auto shrink-0 rounded-sm px-1.5 py-0.5 text-2xs font-semibold", statusBadge.className)}>
              {statusBadge.label}
            </span>
          ) : null}
          <Icon
            name="chevronDown"
            size={12}
            className={cn(
              "text-muted-foreground/60 transition-transform duration-150",
              statusBadge ? "ml-1.5" : "ml-auto",
              open && "rotate-180",
            )}
          />
        </summary>
        <div className="plain-subagent-content ml-1.5 border-l border-primary/25 pl-3.5 text-[12.5px] leading-[1.5] text-muted-foreground [overflow-wrap:anywhere] [&_.markdown-message]:text-muted-foreground [&_.markdown-paragraph]:text-muted-foreground">
          <MarkdownMessage text={text} />
        </div>
      </details>
    </div>
  );
}

function resolveSubagentSummary(item: ConversationToolCallItem) {
  const metadata = parseSubagentMetadata(item.input);
  const fallback = metadata.name ?? metadata.description ?? item.title.trim();
  if (isBackgroundCancelSubagent(item)) {
    return `${fallback || "background_cancel"} · 取消后台任务`;
  }
  if (item.status === "failed" && isOpaqueSubagentTitle(fallback)) {
    return "Error";
  }
  if (metadata.name && metadata.description) {
    return `${metadata.name} · ${metadata.description}`;
  }
  return fallback || "Error";
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
  if (isActiveToolStatus(item.status)) {
    return {
      className: "bg-accent/10 text-accent",
      label: "运行中",
    };
  }
  return null;
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
    ]);
    const description = firstString(record, [
      "description",
      "task",
      "prompt",
      "query",
      "message",
      "instructions",
    ]);
    if (name || description) {
      return { name, description };
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

function PlainToolCallItem({ item }: { item: ConversationToolCallItem }) {
  const tone = resolveToolCallTone(item.toolKind, item.title);
  const preview = item.text.trim() || formatToolInputPreview(item.input);
  return (
    <details
      className="plain-tool-call grid gap-0.5 py-0.5 text-muted-foreground"
      data-tool-kind={tone.label.toLowerCase()}
    >
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-1.5 text-2xs leading-4 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className={cn("grid size-3 place-items-center rounded-sm", tone.className)}>
          <Icon name={resolveToolCallIconName(tone.label)} size={9} />
        </span>
        <Badge
          variant="secondary"
          className={cn("h-4 shrink-0 rounded-sm px-1.5 py-0 text-[10px] font-semibold leading-none", tone.className)}
        >
          {tone.label}
        </Badge>
        <strong className="min-w-0 truncate font-medium text-foreground">
          {item.title}
        </strong>
        <span className="ml-auto shrink-0 text-2xs text-muted-foreground/60">
          {resolveToolStatusLabel(item.status)}
        </span>
      </summary>
      {preview ? (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words pl-8 font-mono text-xs leading-snug text-foreground/85" data-mission-swipe-lock="true">
          {preview}
        </pre>
      ) : null}
    </details>
  );
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

function renderPlainMessageContent(
  message: AgentMessage,
  collapsed: boolean,
  streaming = false,
) {
  if (message.role === "user") {
    return (
      <div
        className={
          collapsed ? "plain-message-text plain-message-text-collapsed line-clamp-3 overflow-hidden whitespace-pre-wrap" : "plain-message-text whitespace-pre-wrap"
        }
      >
        {message.text}
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
          <MarkdownMessage text={segmented.markdown} />
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
      <MarkdownMessage text={message.text} />
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
