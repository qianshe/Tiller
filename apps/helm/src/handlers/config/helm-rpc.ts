import {
  saveHelmToConfig,
} from "@tiller/agent-registry";
import type { HelmSummary } from "@tiller/shared";
import type { HelmHandlerContext } from "../context";

export function shutdownDaemon(context: HelmHandlerContext) {
  context.requestShutdown?.("rpc");
  return {
    ok: true,
    message: "Helm shutdown requested.",
  };
}

export function listHelms(context: HelmHandlerContext) {
  const helms = context.loadAvailableHelms();
  context.setHelms(helms);
  return { helms };
}

export async function saveHelm(params: { helm: HelmSummary }, context: HelmHandlerContext) {
  const result = saveHelmToConfig(params.helm, context.configPath);
  context.setHelms(context.loadAvailableHelms());
  context.setProjects(await context.loadAvailableProjectsWithSemanticSummaries());
  return {
    ok: true,
    helmId: params.helm.id,
    message: `Saved Helm model config to ${result.configPath}`,
  };
}
