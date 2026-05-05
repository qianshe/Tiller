import type { SessionReasoningEffort } from "@tiller/shared";
import { hasOpenCodePortArg } from "../events";

type SessionConfigAdapter = {
  id: string;
  matches: (command: string) => boolean;
  applyLaunchArgs: (args: string[], sessionConfig?: { model?: string; reasoningEffort?: SessionReasoningEffort }) => string[];
  applyEnv: (sessionConfig?: { model?: string; reasoningEffort?: SessionReasoningEffort }) => NodeJS.ProcessEnv;
};

const DEFAULT_SESSION_CONFIG_ADAPTER: SessionConfigAdapter = {
  id: "default",
  matches: () => true,
  applyLaunchArgs: (args) => args,
  applyEnv: () => ({}),
};

const CODEX_SESSION_CONFIG_ADAPTER: SessionConfigAdapter = {
  id: "codex-acp",
  matches: (command) => /^codex-acp(?:\.exe)?$/iu.test(command),
  applyLaunchArgs: (args, sessionConfig) => {
    const nextArgs = [...args];
    if (sessionConfig?.model) {
      nextArgs.push("-c", `model=${JSON.stringify(sessionConfig.model)}`);
    }
    if (sessionConfig?.reasoningEffort) {
      nextArgs.push("-c", `model_reasoning_effort=${JSON.stringify(sessionConfig.reasoningEffort)}`);
    }
    return nextArgs;
  },
  applyEnv: () => ({}),
};

const OPENCODE_SESSION_CONFIG_ADAPTER: SessionConfigAdapter = {
  id: "opencode",
  matches: (command) => /^opencode(?:\.exe)?$/iu.test(command),
  applyLaunchArgs: (args) => {
    const nextArgs = args.filter((value, index, list) => {
      const previous = list[index - 1];
      return value !== "-m" && value !== "--model" && previous !== "-m" && previous !== "--model" && !value.startsWith("--model=");
    });

    if (nextArgs.includes("acp") && !hasOpenCodePortArg(nextArgs)) {
      nextArgs.push("--port", "0");
    }

    return nextArgs;
  },
  applyEnv: (sessionConfig) => {
    const configOverride = buildOpenCodeConfigOverride(sessionConfig);
    if (!configOverride) {
      return {};
    }

    return {
      OPENCODE_CONFIG_CONTENT: JSON.stringify(configOverride),
    };
  },
};

const SESSION_CONFIG_ADAPTERS: SessionConfigAdapter[] = [
  CODEX_SESSION_CONFIG_ADAPTER,
  OPENCODE_SESSION_CONFIG_ADAPTER,
  DEFAULT_SESSION_CONFIG_ADAPTER,
];

function resolveSessionConfigAdapter(command: string) {
  return SESSION_CONFIG_ADAPTERS.find((adapter) => adapter.matches(command)) ?? DEFAULT_SESSION_CONFIG_ADAPTER;
}

export function applySessionLaunchOverrides(
  command: string,
  args: string[],
  sessionConfig?: { model?: string; reasoningEffort?: SessionReasoningEffort },
) {
  return resolveSessionConfigAdapter(command).applyLaunchArgs(args, sessionConfig);
}

export function resolveSessionEnvOverrides(
  command: string,
  sessionConfig?: { model?: string; reasoningEffort?: SessionReasoningEffort },
): NodeJS.ProcessEnv {
  return resolveSessionConfigAdapter(command).applyEnv(sessionConfig);
}

export function buildOpenCodeConfigOverride(sessionConfig?: { model?: string; reasoningEffort?: SessionReasoningEffort }) {
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
