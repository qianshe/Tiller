import { buildAuthoritativeHistoryFromEvents, type BuildAuthoritativeHistoryOptions, type HistoryEvent } from "./history-events";
import type { AcpAuthoritativeHistory, AcpHistoryContext } from "./types";

export type ProviderHistoryReader<TSource> = {
  read(context: AcpHistoryContext): Promise<TSource | null>;
  toEvents(source: TSource, context: AcpHistoryContext): HistoryEvent[];
  build?: (events: HistoryEvent[]) => AcpAuthoritativeHistory;
  options?: BuildAuthoritativeHistoryOptions;
};

export async function loadProviderAuthoritativeHistory<TSource>(
  reader: ProviderHistoryReader<TSource>,
  context: AcpHistoryContext,
): Promise<AcpAuthoritativeHistory | null> {
  const source = await reader.read(context);
  if (!source) {
    return null;
  }
  const events = reader.toEvents(source, context);
  return reader.build
    ? reader.build(events)
    : buildAuthoritativeHistoryFromEvents(events, reader.options);
}
