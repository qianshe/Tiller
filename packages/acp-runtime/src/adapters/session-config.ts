import type { SessionReasoningEffort } from "@tiller/shared";

export type AdapterSessionConfig = {
  model?: string;
  reasoningEffort?: SessionReasoningEffort;
};

export function applyCodexSessionLaunchArgs(
  args: string[],
  sessionConfig?: AdapterSessionConfig,
) {
  const nextArgs = [...args];
  if (sessionConfig?.model) {
    nextArgs.push("-c", `model=${JSON.stringify(sessionConfig.model)}`);
  }
  if (sessionConfig?.reasoningEffort) {
    nextArgs.push("-c", `model_reasoning_effort=${JSON.stringify(sessionConfig.reasoningEffort)}`);
  }
  return nextArgs;
}

export function applyOpenCodeSessionLaunchArgs(args: string[]) {
  const nextArgs = args.filter((value, index, list) => {
    const previous = list[index - 1];
    return value !== "-m" && value !== "--model" && previous !== "-m" && previous !== "--model" && !value.startsWith("--model=");
  });

  if (nextArgs.includes("acp") && !hasOpenCodePortArg(nextArgs)) {
    nextArgs.push("--port", "0");
  }

  return nextArgs;
}

function hasOpenCodePortArg(args: string[]) {
  return args.some(
    (value, index) =>
      value === "--port" || value.startsWith("--port=") || args[index - 1] === "--port",
  );
}

export function resolveOpenCodeSessionEnv(
  sessionConfig?: AdapterSessionConfig,
): NodeJS.ProcessEnv {
  const configOverride = buildOpenCodeConfigOverride(sessionConfig);
  return configOverride ? { OPENCODE_CONFIG_CONTENT: JSON.stringify(configOverride) } : {};
}

export function buildOpenCodeConfigOverride(sessionConfig?: AdapterSessionConfig) {
  if (!sessionConfig?.model && !sessionConfig?.reasoningEffort) {
    return null;
  }

  const nextConfig: Record<string, unknown> = {};
  if (sessionConfig?.model) {
    nextConfig.model = sessionConfig.model;
  }

  if (!sessionConfig?.reasoningEffort || !sessionConfig.model || !sessionConfig.model.includes("/")) {
    return Object.keys(nextConfig).length ? nextConfig : null;
  }

  const [providerId, ...modelParts] = sessionConfig.model.split("/");
  const modelId = modelParts.join("/");
  if (!providerId || !modelId) {
    return Object.keys(nextConfig).length ? nextConfig : null;
  }

  nextConfig.provider = {
    [providerId]: {
      models: {
        [modelId]: {
          options: {
            reasoningEffort: sessionConfig.reasoningEffort,
          },
        },
      },
    },
  };

  return nextConfig;
}
