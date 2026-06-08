import {
  createSessionServiceGraph,
  type SessionServicesOptions,
  type SessionRecord,
} from "./service-factory";

export type { SessionRecord, SessionServicesOptions };

export function createSessionServices(options: SessionServicesOptions) {
  return createSessionServiceGraph(options);
}
