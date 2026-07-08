import { useState } from "react";
import type { CommandChunk } from "@tiller/shared";
import { DAEMON_HOST_KEY, DAEMON_PORT_KEY } from "../../helm-connection/helm-endpoint";

type CommandOutputProps = {
  items: CommandChunk[];
  emptyLabel: string;
};

const DEFAULT_HELM_HOST = "127.0.0.1";
const DEFAULT_HELM_PORT = "47631";

export function CommandOutput({ items, emptyLabel }: CommandOutputProps) {
  if (!items.length) {
    return (
      <div className="rounded-md border border-border-ghost bg-surface-sunken p-4 text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {items.map((item) => (
        <CommandOutputItem key={item.id} item={item} />
      ))}
    </div>
  );
}

function CommandOutputItem({ item }: { item: CommandChunk }) {
  const [expandedText, setExpandedText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const text = expandedText ?? item.text;

  async function expand() {
    if (!item.contentRef?.uri || loading || expandedText) {
      return;
    }
    setLoading(true);
    setFailed(false);
    try {
      const response = await fetch(resolveSessionAssetUri(item.contentRef.uri));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      setExpandedText(await response.text());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-2">
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-terminal-bg p-3 font-mono text-sm leading-relaxed text-terminal-fg">
        {text}
      </pre>
      {item.truncated && item.contentRef ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <button
            type="button"
            className="rounded border border-border-ghost px-2 py-1 hover:bg-surface-sunken"
            onClick={() => void expand()}
            disabled={loading || Boolean(expandedText)}
          >
            {expandedText ? "已展开完整输出" : loading ? "加载中..." : "展开完整输出"}
          </button>
          {failed ? <span>完整输出加载失败</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function resolveSessionAssetUri(uri: string) {
  if (typeof window === "undefined" || !uri.startsWith("/api/")) {
    return uri;
  }
  const helmPort = window.localStorage.getItem(DAEMON_PORT_KEY) ?? DEFAULT_HELM_PORT;
  if (!helmPort || window.location.port === helmPort) {
    return uri;
  }
  const storedHost = window.localStorage.getItem(DAEMON_HOST_KEY);
  const helmHost = !storedHost || storedHost === "0.0.0.0" || storedHost === "::"
    ? (window.location.hostname || DEFAULT_HELM_HOST)
    : storedHost;
  return `${window.location.protocol}//${helmHost}:${helmPort}${uri}`;
}
