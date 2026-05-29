import { memo, useEffect, useState } from "react";
import type { AgentMessage, AgentToolCall } from "@tiller/shared";
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

  return (
    <article
      className={cn(
        "plain-message min-w-0 text-foreground",
        `plain-${message.role}`,
        isStreaming && "plain-message-streaming",
        isAssistant
          ? "mr-auto grid w-full max-w-full grid-cols-[0.75rem_minmax(0,1fr)] items-start gap-x-2.5"
          : "ml-auto grid max-w-[min(620px,72%)] justify-items-end gap-2 text-left",
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
              <figure
                key={`${message.id}-image-${index}`}
                className="mission-message-image w-28 max-w-[30vw] overflow-hidden rounded-[10px] border border-border-ghost bg-surface-sunken shadow-[0_8px_24px_rgb(0_0_0/0.10)]"
              >
                <img
                  src={`data:${image.mimeType};base64,${image.data}`}
                  alt={image.name ?? `粘贴图片 ${index + 1}`}
                  className="h-16 w-full object-cover"
                />
                <figcaption className="truncate px-2 py-1 text-xs text-muted-foreground">
                  {image.name ?? `粘贴图片 ${index + 1}`}
                </figcaption>
              </figure>
            ))}
          </div>
        ) : null}
        <div
          className={cn(
            `${messageBodyClassName} min-w-0 text-sm leading-relaxed [overflow-wrap:anywhere]`,
            message.role === "user" && "rounded-[14px] border border-primary/20 bg-primary-soft/25 px-3 py-2 shadow-[0_8px_24px_rgb(0_0_0/0.12)]",
          )}
        >
          {renderPlainMessageContent(message, isCollapsible && !isExpanded, isStreaming)}
        </div>
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
        {message.role !== "user" && message.attachments?.length ? (
          <div className="mission-message-attachments flex max-w-full flex-wrap gap-2">
            {message.attachments.map((image, index) => (
              <figure
                key={`${message.id}-image-${index}`}
                className="mission-message-image w-28 max-w-[30vw] overflow-hidden rounded-[10px] border border-border-ghost bg-surface-sunken shadow-[0_8px_24px_rgb(0_0_0/0.08)]"
              >
                <img
                  src={`data:${image.mimeType};base64,${image.data}`}
                  alt={image.name ?? `粘贴图片 ${index + 1}`}
                  className="h-16 w-full object-cover"
                />
                <figcaption className="truncate px-2 py-1 text-xs text-muted-foreground">
                  {image.name ?? `粘贴图片 ${index + 1}`}
                </figcaption>
              </figure>
            ))}
          </div>
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

export function PlainThinkingItem({ item }: { item: AgentToolCall }) {
  const isRunning = item.status === "pending" || item.status === "running";
  const text = item.output?.trim() || item.input?.trim() || "暂无 Thinking 内容";
  const [open, setOpen] = useState(isRunning);

  useEffect(() => {
    setOpen(isRunning);
  }, [isRunning]);

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
        <div className="plain-thinking-content ml-1.5 border-l border-primary/25 pl-3.5 text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere] [&_.markdown-message]:text-muted-foreground [&_.markdown-paragraph]:text-muted-foreground">
          <MarkdownMessage text={text} />
        </div>
      </details>
    </div>
  );
}

export function PlainToolGroupItem({ group }: { group: ConversationToolCallItem[] }) {
  const isRunning = group.some((item) => isActiveToolStatus(item.status));
  const [open, setOpen] = useState(isRunning);
  const summaryTitle = summarizeToolGroupTitle(group);
  const groupBadgeLabel = resolveToolGroupBadgeLabel(group);

  useEffect(() => {
    setOpen(isRunning);
  }, [isRunning]);

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
        <div className="plain-tool-group-content ml-1.5 grid max-h-36 gap-1 overflow-y-auto border-l border-primary/25 pl-3.5 pr-1 text-sm text-muted-foreground" data-mission-swipe-lock="true">
          {group.map((item) => (
            <PlainToolCallItem key={item.id} item={item} />
          ))}
        </div>
      </details>
    </div>
  );
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

function resolveToolGroupBadgeLabel(group: ConversationToolCallItem[]): string {
  const labels = resolveToolGroupLabels(group);
  return labels[0] ?? "Tool";
}

function resolveToolGroupLabels(group: ConversationToolCallItem[]) {
  const labels = group.map((item) => resolveToolCallTone(item.toolKind, item.title).label);
  return Array.from(new Set(labels));
}

function summarizeToolGroupTitle(group: ConversationToolCallItem[]) {
  return resolveToolGroupLabels(group).slice(0, 3).join(" / ");
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

