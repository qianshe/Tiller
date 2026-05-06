import type { HelmHandlerContext } from "../context";

export async function handleConfigRpcRequest(
  method: string,
  _params: unknown,
  context: HelmHandlerContext,
): Promise<unknown | undefined> {
  switch (method) {
    case "helm/list": {
      const helms = context.loadAvailableHelms();
      context.setHelms(helms);
      return { helms };
    }
    default:
      return undefined;
  }
}
