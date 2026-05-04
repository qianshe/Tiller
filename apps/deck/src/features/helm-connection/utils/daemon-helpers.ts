import type { HelmSummary } from "@tiller/shared";
import { daemonProfileKey, type DaemonProfile } from "../daemon-profiles";

export function daemonProfileToHelmSummary(profile: DaemonProfile): HelmSummary {
  return {
    id: profile.id,
    name: profile.name,
    host: profile.host,
    port: Number(profile.port),
  };
}

export function mergeHelmSummariesByEndpoint(items: HelmSummary[]) {
  const byEndpoint = new Map<string, HelmSummary>();
  for (const item of items) {
    byEndpoint.set(daemonProfileKey(item.host, String(item.port)), item);
  }
  return Array.from(byEndpoint.values());
}
