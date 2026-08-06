import type { MissionPromptContextItem } from "@tiller/shared";
import { useEffect, useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Icon,
} from "../../../shared/ui";

type PromptContextMenuProps = {
  contexts: MissionPromptContextItem[];
  onRemoveContext?: (id: string) => void;
  resolveTitle: (item: MissionPromptContextItem) => string;
  align?: "start" | "center" | "end";
};

export function PromptContextMenu({
  contexts,
  onRemoveContext,
  resolveTitle,
  align = "start",
}: PromptContextMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [collisionBoundary, setCollisionBoundary] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }
    setCollisionBoundary(
      trigger.closest<HTMLElement>("[data-prompt-context-boundary]") ??
        trigger.closest<HTMLElement>('[data-mission-mobile-pane="chat"]'),
    );
  }, []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          ref={triggerRef}
          className="mission-attachment-chip inline-flex h-6 items-center gap-1.5 rounded border border-border-ghost bg-surface-emphasis px-2 text-xs text-foreground transition-colors hover:bg-surface-emphasis/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label={`评论 ${contexts.length}，展开查看`}
        >
          <Icon name="message" size={11} className="text-muted-foreground" />
          <span>评论</span>
          <span className="grid min-w-4 place-items-center rounded-full bg-surface-sunken px-1 font-mono text-2xs tabular-nums text-muted-foreground">
            {contexts.length}
          </span>
          <Icon name="chevronDown" size={10} className="text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align={align}
        sideOffset={6}
        avoidCollisions={false}
        collisionBoundary={collisionBoundary ?? undefined}
        collisionPadding={8}
        className="max-h-[min(22rem,55vh)] w-[min(22rem,calc(100vw-2rem))] max-w-[var(--radix-dropdown-menu-content-available-width)] overflow-y-auto"
      >
        {contexts.map((item) => {
          const title = resolveTitle(item);
          return (
            <DropdownMenuItem
              key={item.id}
              className="group flex-col items-start gap-0 py-1 text-xs"
              onSelect={(event) => event.preventDefault()}
              aria-label={`评论 ${item.label}`}
            >
              <div className="flex w-full min-w-0 items-center gap-2">
                <span className="text-muted-foreground">{item.kind === "diff" ? "↕" : "❝"}</span>
                <span
                  className="min-w-0 flex-1 truncate font-medium text-foreground"
                  title={title}
                >
                  {title}
                </span>
                {onRemoveContext ? (
                  <button
                    type="button"
                    className="grid h-4 w-4 shrink-0 place-items-center rounded text-muted-foreground opacity-60 transition-opacity hover:bg-surface-sunken hover:text-foreground group-hover:opacity-100"
                    aria-label={`移除评论 ${item.label}`}
                    title="移除"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemoveContext(item.id);
                    }}
                  >
                    <Icon name="x" size={10} />
                  </button>
                ) : null}
              </div>
              {item.comment ? (
                <span className="ml-[18px] min-w-0 break-words text-2xs leading-3 text-muted-foreground">
                  {item.comment}
                </span>
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
