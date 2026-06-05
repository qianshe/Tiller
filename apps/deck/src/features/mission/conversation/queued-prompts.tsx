import type { SessionPromptQueueSnapshot, SessionQueuedPrompt } from "@tiller/shared";
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Icon,
  Textarea,
} from "../../../shared/ui";
import { cn } from "../../../shared/utils/cn";

type QueuedPromptsProps = {
  queue?: SessionPromptQueueSnapshot;
  placement?: "inline" | "floating";
  onUpdate: (sessionId: string, queueItemId: string, text: string) => void;
  onDelete: (sessionId: string, queueItemId: string) => void;
};

function toSingleLine(text: string) {
  return text.replace(/\s+/gu, " ").trim();
}

export function MissionQueuedPrompts({
  queue,
  placement = "inline",
  onUpdate,
  onDelete,
}: QueuedPromptsProps) {
  const items = useMemo(
    () => queue?.queued ?? [],
    [queue?.queued],
  );
  const queueStateKey = items.map((item) => `${item.id}:${item.status}:${item.updatedAt}`).join("\u001f");
  const [drawerState, setDrawerState] = useState(() => ({
    key: queueStateKey,
    open: true,
  }));
  const open = drawerState.key === queueStateKey ? drawerState.open : true;
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const editingItem = items.find((item) => item.id === editingItemId) ?? null;
  const editDraftChanged = Boolean(editingItem && editDraft.trim() !== editingItem.text.trim());

  useEffect(() => {
    setDrawerState((current) => {
      if (current.key === queueStateKey) {
        return current;
      }
      return { key: queueStateKey, open: true };
    });
  }, [queueStateKey]);

  function openEditor(item: SessionQueuedPrompt) {
    setEditingItemId(item.id);
    setEditDraft(item.text);
  }

  function closeEditor() {
    setEditingItemId(null);
    setEditDraft("");
  }

  function saveEditor() {
    const nextText = editDraft.trim();
    if (!editingItem || !nextText) {
      return;
    }
    onUpdate(editingItem.sessionId, editingItem.id, nextText);
    closeEditor();
  }

  if (!items.length) {
    return null;
  }

  return (
    <details
      className={cn(
        "mission-prompt-queue bg-surface/95 p-1",
        placement === "floating"
          ? "pointer-events-auto max-h-[min(32vh,260px)] overflow-y-auto rounded-[8px] border border-border-ghost shadow-[0_-14px_32px_rgb(0_0_0/0.18)]"
          : "border-t border-border-ghost",
      )}
      data-prompt-queue-placement={placement}
      data-prompt-queue-details
      open={open}
      onToggle={(event) => setDrawerState({ key: queueStateKey, open: event.currentTarget.open })}
    >
      <summary
        className="flex min-w-0 cursor-pointer list-none items-center gap-2 px-1 py-1 text-xs font-semibold text-foreground [&::-webkit-details-marker]:hidden"
        data-prompt-queue-summary
      >
        <Icon name="check" size={14} className="text-primary" />
        <span className="min-w-0 truncate">Prompt 队列</span>
        <span className="ml-auto text-muted-foreground">{items.length} 条</span>
        <Icon name="chevronDown" size={12} className="text-muted-foreground/70" />
      </summary>
      <div className="mt-1 rounded-md border border-border-ghost bg-surface-sunken px-1.5 py-0.5">
        {items.map((item) => {
          const editingDisabled = item.status === "sending";
          return (
            <div
              key={item.id}
              className="flex min-w-0 items-center gap-1.5 border-b border-border-ghost py-0.5 last:border-b-0"
            >
              <span
                title={item.text}
                className="mission-queued-prompt-text min-w-0 flex-1 truncate text-xs text-foreground"
              >
                {toSingleLine(item.text)}
              </span>
              {item.error ? (
                <span className="max-w-36 truncate text-xs text-danger" title={item.error}>
                  {item.error}
                </span>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="shrink-0 text-muted-foreground/45"
                disabled
                aria-label="直接发送队列 Prompt（待接入）"
                title="直接发送（待接入）"
              >
                <Icon name="send" size={12} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                disabled={editingDisabled}
                aria-label="编辑队列 Prompt"
                title="编辑"
                onClick={() => openEditor(item)}
              >
                <Icon name="pencil" size={12} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                disabled={editingDisabled}
                aria-label="删除队列 Prompt"
                title="删除"
                onClick={() => onDelete(item.sessionId, item.id)}
              >
                <Icon name="trash" size={12} />
              </Button>
            </div>
          );
        })}
      </div>
      <Dialog open={Boolean(editingItem)} onOpenChange={(open) => (!open ? closeEditor() : undefined)}>
        <DialogContent aria-label="编辑队列 Prompt" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>编辑队列 Prompt</DialogTitle>
            <DialogDescription>
              保存后会更新这条排队 Prompt；ACP 完成当前 Prompt 后按队列顺序发送。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={editDraft}
            rows={8}
            className="min-h-48"
            onChange={(event) => setEditDraft(event.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={closeEditor}>
              取消
            </Button>
            <Button
              type="button"
              disabled={!editDraft.trim() || !editDraftChanged}
              onClick={saveEditor}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </details>
  );
}
