import {
  CLIENT_NOTIFICATION_METHODS,
  CLIENT_REQUEST_METHODS,
  SERVER_NOTIFICATION_METHODS,
  type MethodName,
} from "../methods";

export type RpcMethodDirection = "client-request" | "client-notification" | "server-notification";

export type RpcMethodFamily =
  | "agent"
  | "approval"
  | "daemon"
  | "device"
  | "error"
  | "helm"
  | "permission"
  | "project"
  | "session";

export type RpcMethodInventoryItem = {
  method: MethodName;
  family: RpcMethodFamily;
  direction: RpcMethodDirection;
  helmHandlerDomain: RpcMethodFamily;
  contractPackage: "@tiller/sync-protocol";
};

const METHOD_DIRECTIONS = [
  ...CLIENT_REQUEST_METHODS.map((method) => [method, "client-request"] as const),
  ...CLIENT_NOTIFICATION_METHODS.map((method) => [method, "client-notification"] as const),
  ...SERVER_NOTIFICATION_METHODS.map((method) => [method, "server-notification"] as const),
] satisfies Array<readonly [MethodName, RpcMethodDirection]>;

export const RPC_METHOD_INVENTORY: RpcMethodInventoryItem[] = METHOD_DIRECTIONS.map(
  ([method, direction]) => {
    const family = resolveMethodFamily(method);
    return {
      method,
      family,
      direction,
      helmHandlerDomain: family,
      contractPackage: "@tiller/sync-protocol",
    };
  },
);

export function resolveMethodFamily(method: MethodName): RpcMethodFamily {
  const family = method.split("/", 1)[0];
  if (isRpcMethodFamily(family)) {
    return family;
  }
  throw new Error(`Unsupported RPC method family: ${method}`);
}

function isRpcMethodFamily(value: string | undefined): value is RpcMethodFamily {
  return (
    value === "agent" ||
    value === "approval" ||
    value === "daemon" ||
    value === "device" ||
    value === "error" ||
    value === "helm" ||
    value === "permission" ||
    value === "project" ||
    value === "session"
  );
}
