import {
  createSessionServiceGraph,
  type SessionServicesOptions,
  type SessionRecord,
} from "./session-service-factory";

export type { SessionRecord, SessionServicesOptions };

export function createSessionServices(options: SessionServicesOptions) {
  return createSessionServiceGraph(options);
}
