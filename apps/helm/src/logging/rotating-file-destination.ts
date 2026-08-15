import { appendFileSync } from "node:fs";
import {
  open,
  rename,
  stat,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { Writable } from "node:stream";
import type { DestinationStream } from "pino";

export const DEFAULT_MAX_LOG_FILE_BYTES = 10 * 1024 * 1024;
export const DEFAULT_RETAINED_LOG_FILES = 5;
export const DEFAULT_MAX_LOG_QUEUE_BYTES = 4 * 1024 * 1024;

type QueuedLogChunk = {
  buffer: Buffer;
  droppable: boolean;
};

export function createRotatingFileDestination(options: {
  filePath: string;
  maxFileBytes?: number;
  retainedFiles?: number;
  maxQueueBytes?: number;
}): Writable & DestinationStream & { flush(): Promise<void>; flushSync(): void; getDroppedCount(): number } {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_LOG_FILE_BYTES;
  const retainedFiles = options.retainedFiles ?? DEFAULT_RETAINED_LOG_FILES;
  const maxQueueBytes = options.maxQueueBytes ?? DEFAULT_MAX_LOG_QUEUE_BYTES;
  const queue: QueuedLogChunk[] = [];
  let queuedBytes = 0;
  let droppedDebugInfo = 0;
  let totalDroppedDebugInfo = 0;
  let fileHandle: FileHandle | undefined;
  let currentBytes = 0;
  let drainPromise: Promise<void> | undefined;
  let closed = false;
  let fileWritesDisabled = false;

  function disableFileWrites(): void {
    if (fileWritesDisabled) {
      return;
    }
    fileWritesDisabled = true;
    queue.length = 0;
    queuedBytes = 0;
    droppedDebugInfo = 0;
    if (fileHandle) {
      const handle = fileHandle;
      fileHandle = undefined;
      void handle.close().catch(() => undefined);
    }
  }

  async function ensureFileHandle(): Promise<FileHandle> {
    if (fileHandle) {
      return fileHandle;
    }
    const nextHandle = await open(options.filePath, "a");
    fileHandle = nextHandle;
    currentBytes = (await stat(options.filePath)).size;
    return nextHandle;
  }

  async function removeIfPresent(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  async function renameIfPresent(source: string, target: string): Promise<void> {
    try {
      await rename(source, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  async function rotate(): Promise<void> {
    if (fileHandle) {
      await fileHandle.close();
      fileHandle = undefined;
    }
    if (retainedFiles > 0) {
      await removeIfPresent(`${options.filePath}.${retainedFiles}`);
      for (let generation = retainedFiles - 1; generation >= 1; generation -= 1) {
        await renameIfPresent(
          `${options.filePath}.${generation}`,
          `${options.filePath}.${generation + 1}`,
        );
      }
      await renameIfPresent(options.filePath, `${options.filePath}.1`);
    } else {
      await removeIfPresent(options.filePath);
    }
    currentBytes = 0;
    await ensureFileHandle();
  }

  async function writeBuffer(buffer: Buffer): Promise<void> {
    await ensureFileHandle();
    if (currentBytes > 0 && currentBytes + buffer.byteLength > maxFileBytes) {
      await rotate();
    }
    const handle = await ensureFileHandle();
    await handle.writeFile(buffer);
    currentBytes += buffer.byteLength;
  }

  function recordDropped(count = 1): void {
    droppedDebugInfo += count;
    totalDroppedDebugInfo += count;
    beginDrain();
  }

  function evictDroppableChunks(requiredBytes: number): void {
    if (queuedBytes + requiredBytes <= maxQueueBytes) {
      return;
    }
    for (let index = 0; index < queue.length && queuedBytes + requiredBytes > maxQueueBytes;) {
      const item = queue[index];
      if (!item?.droppable) {
        index += 1;
        continue;
      }
      queuedBytes -= item.buffer.byteLength;
      queue.splice(index, 1);
      recordDropped();
    }
  }

  function enqueue(chunk: string | Buffer): void {
    if (fileWritesDisabled) {
      return;
    }
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const droppable = isDroppableLogChunk(buffer);
    if (droppable && queuedBytes + buffer.byteLength > maxQueueBytes) {
      recordDropped();
      return;
    }
    if (!droppable) {
      evictDroppableChunks(buffer.byteLength);
      if (queuedBytes + buffer.byteLength > maxQueueBytes) {
        // Preserve warning/error logs when the asynchronous queue is saturated.
        try {
          appendFileSync(options.filePath, buffer);
          currentBytes += buffer.byteLength;
        } catch {
          disableFileWrites();
        }
        return;
      }
    }
    queue.push({ buffer, droppable });
    queuedBytes += buffer.byteLength;
    beginDrain();
  }

  function beginDrain(): void {
    if (drainPromise || (queue.length === 0 && droppedDebugInfo === 0)) {
      return;
    }
    drainPromise = drain().finally(() => {
      drainPromise = undefined;
      if (queue.length > 0 && !closed) {
        beginDrain();
      }
    });
  }

  async function drain(): Promise<void> {
    try {
      while (queue.length > 0 || droppedDebugInfo > 0) {
        if (droppedDebugInfo > 0) {
          const dropped = droppedDebugInfo;
          droppedDebugInfo = 0;
          await writeBuffer(Buffer.from(
            `${JSON.stringify({ level: "warn", event: "logging.queue_dropped", droppedDebugInfo: dropped, time: new Date().toISOString() })}\n`,
          ));
        }
        const item = queue.shift();
        if (!item) {
          continue;
        }
        queuedBytes -= item.buffer.byteLength;
        await writeBuffer(item.buffer);
      }
    } catch {
      // A full or unavailable disk must not turn logger failure into an
      // unhandled rejection or recursively generate more log writes.
      disableFileWrites();
    }
  }

  async function flush(): Promise<void> {
    while (queue.length > 0 || droppedDebugInfo > 0 || drainPromise) {
      beginDrain();
      await drainPromise;
    }
  }

  async function closeFile(): Promise<void> {
    await flush();
    if (fileHandle) {
      await fileHandle.close();
      fileHandle = undefined;
    }
  }

  const destination = new Writable({
    write(chunk, _encoding, callback) {
      try {
        enqueue(chunk);
        callback();
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    },
    final(callback) {
      closed = true;
      void closeFile().then(
        () => callback(),
        (error) => callback(error instanceof Error ? error : new Error(String(error))),
      );
    },
    destroy(error, callback) {
      closed = true;
      void closeFile().then(
        () => callback(error),
        (closeError) => callback(closeError instanceof Error ? closeError : new Error(String(closeError))),
      );
    },
  });

  return Object.assign(destination, {
    flush,
    flushSync() {
      beginDrain();
    },
    getDroppedCount() {
      return totalDroppedDebugInfo;
    },
  });
}

function isDroppableLogChunk(buffer: Buffer): boolean {
  const text = buffer.toString("utf8", 0, Math.min(buffer.byteLength, 256));
  return /"level":"(?:trace|debug|info)"/u.test(text) || /\b(?:TRACE|DEBUG|INFO)\b/u.test(text);
}
