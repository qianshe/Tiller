import type { WebSocket } from "ws";
import {
  decodeMessage,
  encodeMessage,
  ErrorCode,
  rpcError,
  type JsonRpcMessage,
  type Stream,
} from "@tiller/sync-protocol";

const SOFT_SEND_BUFFER_BYTES = 2 * 1024 * 1024;
const MAX_SEND_BUFFER_BYTES = 16 * 1024 * 1024;
const MAX_COALESCED_BYTES = 2 * 1024 * 1024;
const MAX_COALESCED_ENTRIES = 1_024;
export const WEBSOCKET_RESYNC_CLOSE_CODE = 4009;

export type WebSocketBackpressureOptions = {
  softHighWaterBytes?: number;
  hardHighWaterBytes?: number;
  maxCoalescedBytes?: number;
  maxCoalescedEntries?: number;
  retryDelayMs?: number;
  onCoalesced?: (count: number) => void;
  onEncoded?: (bytes: number) => void;
};

type EncodedMessage = {
  encoded: string;
  bytes: number;
};

type PendingMessage = EncodedMessage & {
  sequence: number;
  liveStateSequence?: number;
};

const encodedMessageCache = new WeakMap<object, EncodedMessage>();

export function createWebSocketJsonRpcStream(
  socket: WebSocket,
  onDecodeError: (error: unknown) => void,
  options: WebSocketBackpressureOptions = {},
): Stream {
  const handlers = new Set<(message: JsonRpcMessage) => void>();
  const pending = new Map<string, PendingMessage>();
  const softHighWater = options.softHighWaterBytes ?? SOFT_SEND_BUFFER_BYTES;
  const hardHighWater = options.hardHighWaterBytes ?? MAX_SEND_BUFFER_BYTES;
  const maxCoalescedBytes = options.maxCoalescedBytes ?? MAX_COALESCED_BYTES;
  const maxCoalescedEntries = options.maxCoalescedEntries ?? MAX_COALESCED_ENTRIES;
  const retryDelayMs = options.retryDelayMs ?? 10;
  let pendingBytes = 0;
  let pendingSequence = 0;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;

  const closeForResync = () => {
    pending.clear();
    pendingBytes = 0;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = undefined;
    socket.close(WEBSOCKET_RESYNC_CLOSE_CODE, "Resync required: send buffer overflow");
  };

  const encodeOnce = (message: JsonRpcMessage): EncodedMessage => {
    if (message && typeof message === "object") {
      const cached = encodedMessageCache.get(message);
      if (cached) {
        return cached;
      }
      const encoded = encodeMessage(message);
      const next = { encoded, bytes: Buffer.byteLength(encoded) };
      encodedMessageCache.set(message, next);
      options.onEncoded?.(next.bytes);
      return next;
    }
    const encoded = encodeMessage(message);
    const next = { encoded, bytes: Buffer.byteLength(encoded) };
    options.onEncoded?.(next.bytes);
    return next;
  };

  const sendEncoded = (payload: EncodedMessage) => {
    if (socket.bufferedAmount >= hardHighWater) {
      closeForResync();
      return false;
    }
    socket.send(payload.encoded);
    return true;
  };

  const scheduleFlush = () => {
    if (flushTimer || pending.size === 0) return;
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      if (socket.readyState !== 1) return;
      if (socket.bufferedAmount >= hardHighWater) {
        closeForResync();
        return;
      }
      if (socket.bufferedAmount >= softHighWater) {
        scheduleFlush();
        return;
      }
      const queued = [...pending.values()].sort((left, right) => left.sequence - right.sequence);
      pending.clear();
      pendingBytes = 0;
      for (const item of queued) {
        if (!sendEncoded(item)) return;
      }
    }, retryDelayMs);
    flushTimer.unref?.();
  };

  const enqueueCoalescible = (key: string, message: JsonRpcMessage) => {
    const payload = encodeOnce(message);
    const previous = pending.get(key);
    const liveStateSequence = resolveLiveStateSequence(message);
    if (
      previous?.liveStateSequence !== undefined &&
      liveStateSequence !== undefined &&
      liveStateSequence <= previous.liveStateSequence
    ) {
      return;
    }
    const nextBytes = pendingBytes - (previous?.bytes ?? 0) + payload.bytes;
    if (
      nextBytes > maxCoalescedBytes ||
      (!previous && pending.size >= maxCoalescedEntries)
    ) {
      closeForResync();
      return;
    }
    pendingBytes = nextBytes;
    pending.set(key, {
      ...payload,
      sequence: ++pendingSequence,
      ...(liveStateSequence !== undefined ? { liveStateSequence } : {}),
    });
    options.onCoalesced?.(previous ? 1 : 0);
    scheduleFlush();
  };
  const onRawMessage = (raw: unknown) => {
    try {
      const message = decodeMessage(String(raw));
      for (const handler of handlers) {
        handler(message);
      }
    } catch (error) {
      onDecodeError(error);
      const payload =
        error && typeof error === "object" && "code" in error
          ? (error as { code: number; message: string; data?: unknown })
          : rpcError(ErrorCode.ParseError, "Parse error");
      if (socket.readyState === 1) {
        socket.send(encodeOnce({ jsonrpc: "2.0", id: null, error: payload }).encoded);
      }
    }
  };

  socket.on("message", onRawMessage);

  return {
    send(message) {
      if (socket.readyState !== 1) {
        return;
      }
      if (socket.bufferedAmount >= hardHighWater) {
        closeForResync();
        return;
      }
      if (socket.bufferedAmount >= softHighWater) {
        const split = splitCoalescibleSessionUpdate(message);
        if (split) {
          for (const item of split.coalescible) {
            enqueueCoalescible(item.key, item.message);
          }
          if (split.required) sendEncoded(encodeOnce(split.required));
          return;
        }
      }
      sendEncoded(encodeOnce(message));
    },
    onMessage(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    close() {
      if (flushTimer) clearTimeout(flushTimer);
      pending.clear();
      socket.off("message", onRawMessage);
    },
  };
}

function splitCoalescibleSessionUpdate(message: JsonRpcMessage) {
  const notification = message as any;
  if (notification?.method !== "session/update") return undefined;
  const sessionId = notification.params?.sessionId;
  const update = notification.params?.update;
  if (typeof sessionId !== "string" || !update) return undefined;
  const directKey = coalescibleUpdateKey(sessionId, update);
  if (directKey) {
    return { coalescible: [{ key: directKey, message }], required: undefined };
  }
  if (update.kind !== "timeline_batch" || !Array.isArray(update.batch?.entries)) {
    return undefined;
  }
  const coalescible: Array<{ key: string; message: JsonRpcMessage }> = [];
  const requiredEntries: unknown[] = [];
  for (const entry of update.batch.entries) {
    const key = coalescibleTimelineEntryKey(sessionId, entry);
    if (!key) {
      requiredEntries.push(entry);
      continue;
    }
    coalescible.push({
      key,
      message: {
        ...notification,
        params: {
          ...notification.params,
          update: {
            ...update,
            batch: { ...update.batch, entries: [entry] },
          },
        },
      },
    });
  }
  if (coalescible.length === 0) return undefined;
  return {
    coalescible,
    required: requiredEntries.length === 0 ? undefined : {
      ...notification,
      params: {
        ...notification.params,
        update: {
          ...update,
          batch: { ...update.batch, entries: requiredEntries },
        },
      },
    },
  };
}

function coalescibleUpdateKey(sessionId: string, update: any) {
  if (update.kind === "live_state" && Number.isFinite(update.snapshot?.sequence)) {
    return `${sessionId}:live_state`;
  }
  if (update.kind === "agent_message" && update.streaming === true && update.message?.id) {
    return `${sessionId}:message:${update.message.id}`;
  }
  if (update.kind === "tool_call" && update.toolCall?.status === "running" && update.toolCall?.id) {
    return `${sessionId}:tool:${update.toolCall.id}`;
  }
  return undefined;
}

function resolveLiveStateSequence(message: JsonRpcMessage): number | undefined {
  const notification = message as any;
  const sequence = notification?.method === "session/update" &&
    notification.params?.update?.kind === "live_state"
    ? notification.params.update.snapshot?.sequence
    : undefined;
  return typeof sequence === "number" && Number.isFinite(sequence) ? sequence : undefined;
}

function coalescibleTimelineEntryKey(sessionId: string, entry: any) {
  if (
    entry?.kind === "assistant_message" &&
    entry.id &&
    (
      entry.streaming === true ||
      entry.chunks?.some?.((chunk: any) =>
        chunk?.streaming === true ||
        (chunk?.kind === "thinking" && chunk?.status === "running")
      )
    )
  ) {
    return `${sessionId}:timeline:${entry.id}`;
  }
  if (entry?.kind === "tool_call" && entry.toolCall?.status === "running" && entry.id) {
    return `${sessionId}:timeline:${entry.id}`;
  }
  return undefined;
}
