import type {
  SessionActivitySummary,
  SessionActivityTrendPoint,
  SessionTimelineEntry,
} from "@tiller/shared";
import type { HelmHandlerContext } from "../context";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const TREND_DAYS = 30;
const TREND_HOURS = 24;

type ActivityEvent = {
  kind: "prompt" | "tool";
  timestampMs: number;
};

function resolveTimestamp(value: unknown) {
  if (typeof value !== "string") return null;
  const timestampMs = Date.parse(value);
  return Number.isNaN(timestampMs) ? null : timestampMs;
}

function collectActivityEvents(
  timelines: ReadonlyMap<string, SessionTimelineEntry[]>,
  now: number,
): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const entries of timelines.values()) {
    for (const entry of entries) {
      const timestamp = entry.kind === "tool_call"
        ? entry.toolCall.timestamp ?? entry.timestamp
        : entry.timestamp;
      const timestampMs = resolveTimestamp(timestamp);
      if (timestampMs === null || timestampMs > now) continue;
      if (entry.kind === "user_message") {
        events.push({ kind: "prompt", timestampMs });
      } else if (entry.kind === "tool_call") {
        events.push({ kind: "tool", timestampMs });
      }
    }
  }
  return events;
}

function buildTrend(
  events: ActivityEvent[],
  now: number,
  bucketMs: number,
  bucketCount: number,
  formatDate: (timestampMs: number) => string,
): SessionActivityTrendPoint[] {
  const currentBucket = Math.floor(now / bucketMs) * bucketMs;
  const startBucket = currentBucket - (bucketCount - 1) * bucketMs;
  const points = Array.from({ length: bucketCount }, (_, index) => ({
    date: formatDate(startBucket + index * bucketMs),
    promptCount: 0,
    toolCallCount: 0,
  }));
  const pointsByBucket = new Map(
    points.map((point, index) => [startBucket + index * bucketMs, point]),
  );

  for (const event of events) {
    const bucket = Math.floor(event.timestampMs / bucketMs) * bucketMs;
    const point = pointsByBucket.get(bucket);
    if (!point) continue;
    point[event.kind === "prompt" ? "promptCount" : "toolCallCount"] += 1;
  }
  return points;
}

export function buildSessionActivitySummary(
  timelines: ReadonlyMap<string, SessionTimelineEntry[]>,
  now = Date.now(),
): SessionActivitySummary {
  const events = collectActivityEvents(timelines, now);
  const recentCutoff = now - DAY_MS;
  const promptCount = events.filter(
    (event) => event.kind === "prompt" && event.timestampMs >= recentCutoff,
  ).length;
  const recentToolCallCount = events.filter(
    (event) => event.kind === "tool" && event.timestampMs >= recentCutoff,
  ).length;

  return {
    generatedAt: new Date(now).toISOString(),
    promptCount,
    recentToolCallCount,
    toolCallCount: events.filter((event) => event.kind === "tool").length,
    activityTrend: buildTrend(
      events,
      now,
      DAY_MS,
      TREND_DAYS,
      (timestampMs) => new Date(timestampMs).toISOString().slice(0, 10),
    ),
    activityTrendHourly: buildTrend(
      events,
      now,
      HOUR_MS,
      TREND_HOURS,
      (timestampMs) => new Date(timestampMs).toISOString(),
    ),
  };
}

export function getSessionActivitySummary(
  context: Pick<HelmHandlerContext, "sessionStore" | "sessionTimelineStore">,
) {
  const timelines = new Map<string, SessionTimelineEntry[]>();
  for (const session of context.sessionStore.list()) {
    timelines.set(session.id, context.sessionTimelineStore.list(session.id));
  }
  return buildSessionActivitySummary(timelines);
}
