import type { SessionPromptQueueSnapshot, SessionQueuedPrompt } from "@tiller/shared";
import { useEffect, useMemo, useState } from "react";
import { Button, Input } from "../../../shared/ui";

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
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    setDrafts((current) => {
      const next: Record<string, string> = {};
      let changed = false;
      for (const item of items) {
        next[item.id] = current[item.id] ?? toSingleLine(item.text);
        changed = changed || next[item.id] !== current[item.id];
      }
      changed = changed || Object.keys(current).length !== items.length;
      return changed ? next : current;
    });
  }, [items]);

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
          const draft = drafts[item.id] ?? toSingleLine(item.text);
          const editingDisabled = item.status === "sending";
          const changed = draft.trim() !== toSingleLine(item.text);
          return (
            <div
              key={item.id}
              className="flex min-w-0 items-center gap-2 border-b border-border-ghost py-1.5 last:border-b-0"
            >
              <div className="w-16 shrink-0 text-xs text-muted-foreground">
                <span>{queueItemLabel(item, index)}</span>
              </div>
              <Input
                value={draft}
                disabled={editingDisabled}
                title={item.text}
                className="h-9 min-w-0 flex-1"
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [item.id]: toSingleLine(event.target.value),
                  }))
                }
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
                disabled={editingDisabled || !changed || !draft.trim()}
                onClick={() => onUpdate(item.sessionId, item.id, draft)}
              >
                保存
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
    </div>
  );
}
