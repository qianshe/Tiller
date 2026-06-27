export { useHelmConnection } from "./hooks/connection";
export { useAppControllers } from "./actions/deck-controllers";
export {
  daemonProfileKey,
  formatDaemonProfileLine,
  mergeDaemonProfile,
  readDaemonProfiles,
  type DaemonProfile,
} from "./daemon-profiles";
export { resolveDefaultHelmEndpoint, DAEMON_HOST_KEY, DAEMON_PORT_KEY } from "./helm-endpoint";
export {
  dispatchWithTrace,
  type DispatchToHelm,
} from "./request-dispatch";
export { DeckRpcClient } from "./rpc-client";
export { shouldCheckHelmHealth } from "./reconnect-policy";
export type { HelmHealthStatus } from "../../store/facade";
