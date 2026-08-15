export type SessionActivityTrendPoint = {
  date: string;
  promptCount: number;
  toolCallCount: number;
};

export type SessionActivitySummary = {
  /** Server time at which the persisted timeline snapshot was calculated. */
  generatedAt: string;
  /** Prompt count in the last 24 hours. */
  promptCount: number;
  /** Tool-call count in the last 24 hours. */
  recentToolCallCount: number;
  /** Tool-call count across all persisted timeline history. */
  toolCallCount: number;
  activityTrend: SessionActivityTrendPoint[];
  activityTrendHourly: SessionActivityTrendPoint[];
};
