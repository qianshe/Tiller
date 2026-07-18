import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createSessionTimelineWorker } from "../src/runtime/session-timeline/worker";

type MemoryObservation = {
  heapUsed: number;
};

type ScenarioSample = {
  durationMs: number;
  heapDeltaBytes: number;
  peakHeapDeltaBytes: number;
};

type ScenarioResult = {
  name: string;
  operations: number;
  samples: ScenarioSample[];
  durationMs: {
    median: number;
    min: number;
    max: number;
  };
  heapDeltaBytes: {
    median: number;
  };
  peakHeapDeltaBytes: {
    median: number;
    max: number;
  };
};

type Workload = (observeMemory: () => MemoryObservation) => void;

const args = parseArgs(process.argv.slice(2));
const sampleCount = parsePositiveInteger(args.samples, 5);
const label = args.label ?? "benchmark";
const scenarios = [
  benchmarkScenario("completed-entries-1k", 1_000, sampleCount, completedEntriesWorkload(1_000)),
  benchmarkScenario("completed-entries-10k", 10_000, sampleCount, completedEntriesWorkload(10_000)),
  benchmarkScenario("streaming-entity-updates-10k", 10_000, sampleCount, streamingEntityWorkload(10_000)),
  benchmarkScenario("interleaved-two-sessions-2k", 2_000, sampleCount, interleavedSessionsWorkload(1_000)),
];
const report = {
  schemaVersion: 1,
  label,
  recordedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuModel: cpus()[0]?.model ?? "unknown",
    cpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
    sampleCount,
    warmupCount: 1,
    gcExposed: typeof getGc() === "function",
  },
  scenarios,
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;

if (args.output) {
  const outputPath = resolve(args.output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, serialized, "utf8");
}

process.stdout.write(serialized);

function benchmarkScenario(
  name: string,
  operations: number,
  samples: number,
  workload: Workload,
): ScenarioResult {
  measure(workload);
  const measured = Array.from({ length: samples }, () => measure(workload));
  const durations = measured.map((sample) => sample.durationMs);
  const heapDeltas = measured.map((sample) => sample.heapDeltaBytes);
  const peakHeapDeltas = measured.map((sample) => sample.peakHeapDeltaBytes);
  return {
    name,
    operations,
    samples: measured,
    durationMs: {
      median: round(median(durations)),
      min: round(Math.min(...durations)),
      max: round(Math.max(...durations)),
    },
    heapDeltaBytes: {
      median: Math.round(median(heapDeltas)),
    },
    peakHeapDeltaBytes: {
      median: Math.round(median(peakHeapDeltas)),
      max: Math.round(Math.max(...peakHeapDeltas)),
    },
  };
}

function measure(workload: Workload): ScenarioSample {
  forceGc();
  const beforeHeap = process.memoryUsage().heapUsed;
  let peakHeap = beforeHeap;
  const observeMemory = () => {
    const observation = { heapUsed: process.memoryUsage().heapUsed };
    peakHeap = Math.max(peakHeap, observation.heapUsed);
    return observation;
  };
  const startedAt = performance.now();
  workload(observeMemory);
  const durationMs = performance.now() - startedAt;
  observeMemory();
  forceGc();
  const afterHeap = process.memoryUsage().heapUsed;
  return {
    durationMs: round(durationMs),
    heapDeltaBytes: afterHeap - beforeHeap,
    peakHeapDeltaBytes: peakHeap - beforeHeap,
  };
}

function completedEntriesWorkload(count: number): Workload {
  return (observeMemory) => {
    const worker = createSessionTimelineWorker({ sessionId: `completed-${count}` });
    for (let sequence = 1; sequence <= count; sequence += 1) {
      worker.enqueue({
        type: "tool-call",
        toolCall: {
          id: `tool-${sequence}`,
          kind: "read",
          title: "Read",
          status: "completed",
          timestamp: "2026-07-18T00:00:00.000Z",
          updatedAt: "2026-07-18T00:00:00.000Z",
          sequence,
        },
      });
      if (sequence % 1_000 === 0) observeMemory();
    }
    const batch = worker.flush()[0]?.batch;
    if (batch?.entries.length !== count) {
      throw new Error(`Expected ${count} completed entries, got ${batch?.entries.length ?? 0}.`);
    }
    observeMemory();
  };
}

function streamingEntityWorkload(count: number): Workload {
  return (observeMemory) => {
    const worker = createSessionTimelineWorker({ sessionId: `streaming-${count}` });
    for (let sequence = 1; sequence <= count; sequence += 1) {
      worker.enqueue({
        type: "tool-call",
        toolCall: {
          id: "streaming-tool",
          kind: "read",
          title: "Read",
          status: "running",
          timestamp: "2026-07-18T00:00:00.000Z",
          updatedAt: "2026-07-18T00:00:00.000Z",
          sequence,
        },
      });
      if (sequence % 1_000 === 0) observeMemory();
    }
    const batch = worker.flush()[0]?.batch;
    if (batch?.entries.length !== 1) {
      throw new Error(`Expected one streaming entry, got ${batch?.entries.length ?? 0}.`);
    }
    observeMemory();
  };
}

function interleavedSessionsWorkload(perSession: number): Workload {
  return (observeMemory) => {
    const first = createSessionTimelineWorker({ sessionId: "interleaved-a" });
    const second = createSessionTimelineWorker({ sessionId: "interleaved-b" });
    for (let sequence = 1; sequence <= perSession; sequence += 1) {
      enqueueCompleted(first, "a", sequence);
      enqueueCompleted(second, "b", sequence);
      if (sequence % 500 === 0) observeMemory();
    }
    const firstBatch = first.flush()[0]?.batch;
    const secondBatch = second.flush()[0]?.batch;
    if (firstBatch?.entries.length !== perSession || secondBatch?.entries.length !== perSession) {
      throw new Error("Interleaved session entries were not isolated.");
    }
    if (firstBatch.entries.some((entry) => entry.id.includes("tool-b-")) ||
        secondBatch.entries.some((entry) => entry.id.includes("tool-a-"))) {
      throw new Error("Interleaved session entries crossed session boundaries.");
    }
    observeMemory();
  };
}

function enqueueCompleted(
  worker: ReturnType<typeof createSessionTimelineWorker>,
  prefix: string,
  sequence: number,
): void {
  worker.enqueue({
    type: "tool-call",
    toolCall: {
      id: `${prefix}-${sequence}`,
      kind: "read",
      title: "Read",
      status: "completed",
      timestamp: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:00.000Z",
      sequence,
    },
  });
}

function parseArgs(values: string[]): Record<string, string | undefined> {
  const parsed: Record<string, string | undefined> = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value?.startsWith("--")) continue;
    parsed[value.slice(2)] = values[index + 1];
    index += 1;
  }
  return parsed;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function forceGc(): void {
  getGc()?.();
}

function getGc(): (() => void) | undefined {
  return (globalThis as typeof globalThis & { gc?: () => void }).gc;
}
