export type WarmRuntimeKey = {
  workspaceId: string;
  agentId: string;
  configKey?: string;
};

export function createWarmRuntimePool<Runtime>() {
  const runtimes = new Map<string, Runtime>();

  return {
    set(key: WarmRuntimeKey, runtime: Runtime) {
      runtimes.set(serializeWarmRuntimeKey(key), runtime);
    },
    get(key: WarmRuntimeKey) {
      return runtimes.get(serializeWarmRuntimeKey(key));
    },
    take(key: WarmRuntimeKey) {
      const serialized = serializeWarmRuntimeKey(key);
      const runtime = runtimes.get(serialized);
      runtimes.delete(serialized);
      return runtime;
    },
    delete(key: WarmRuntimeKey) {
      return runtimes.delete(serializeWarmRuntimeKey(key));
    },
    clear() {
      runtimes.clear();
    },
    size() {
      return runtimes.size;
    },
  };
}

function serializeWarmRuntimeKey({ workspaceId, agentId, configKey = "" }: WarmRuntimeKey) {
  return `${workspaceId}\u0000${agentId}\u0000${configKey}`;
}
