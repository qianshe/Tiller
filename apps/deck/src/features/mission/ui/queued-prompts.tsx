import type { SessionPromptQueueSnapshot, SessionQueuedPrompt } from "@tiller/shared";
import { useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
} from "../../../shared/ui";

type QueuedPromptsProps = {
  queue?: SessionPromptQueueSnapshot;
  onUpdate: (sessionId: string, queueItemId: string, text: string) => void;
  onDelete: (sessionId: string, queueItemId: string) => void;
};

function queueItemLabel(item: SessionQueuedPrompt, index: number) {
  if (item.status === "sending") {
    return "发送中";
  }
  if (item.status === "failed") {
    return "失败";
  }
  return `排队 #${index + 1}`;
}

function toSingleLine(text: string) {
  return text.replace(/\s+/gu, " ").trim();
}

export function MissionQueuedPrompts({
  queue,
  onUpdate,
  onDelete,
}: QueuedPromptsProps) {
  const items = useMemo(
    () => queue?.queued ?? [],
    [queue?.queued],
  );
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const editingItem = items.find((item) => item.id === editingItemId) ?? null;
  const editDraftChanged = Boolean(editingItem && editDraft.trim() !== editingItem.text.trim());

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
    <div className="mission-prompt-queue border-t border-border-ghost bg-surface/95 p-3">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <strong className="text-foreground">Prompt 队列</strong>
        <span className="truncate">ACP 完成当前 Prompt 后会自动发送队首</span>
      </div>
      <div className="rounded-lg border border-border-ghost bg-surface-sunken px-2 py-1">
        {items.map((item, index) => {
          const editingDisabled = item.status === "sending";
          return (
            <div
              key={item.id}
              className="flex min-w-0 items-center gap-2 border-b border-border-ghost py-1.5 last:border-b-0"
            >
              <div className="w-16 shrink-0 text-xs text-muted-foreground">
                <span>{queueItemLabel(item, index)}</span>
              </div>
              <Input
                value={toSingleLine(item.text)}
                readOnly
                disabled={editingDisabled}
                title={item.text}
                className="h-9 min-w-0 flex-1"
              />
              {item.error ? (
                <span className="max-w-36 truncate text-xs text-danger" title={item.error}>
                  {item.error}
                </span>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0"
                disabled={editingDisabled}
                onClick={() => openEditor(item)}
              >
                编辑
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0"
                disabled={editingDisabled}
                onClick={() => onDelete(item.sessionId, item.id)}
              >
                删除
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
    </div>
  );
}
