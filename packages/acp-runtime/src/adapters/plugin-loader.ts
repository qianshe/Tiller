import type { ProviderAdapterPluginManifest } from "./types";

export function resolveAdapterPluginManifest(): ProviderAdapterPluginManifest {
  return {
    kind: "provider-adapter-plugin-placeholder",
    enabled: false,
    adapters: [],
  };
}
