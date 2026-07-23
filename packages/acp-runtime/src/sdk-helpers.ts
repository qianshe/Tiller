import * as acp from "@agentclientprotocol/sdk";
import type {
  AcpMcpServer,
  AgentPromptContent,
  PermissionDecision,
  PermissionRequest,
  PermissionRequestOption,
} from "@tiller/shared";

export const SDK_PROBE_CLIENT_CAPABILITIES = {
  fs: {
    readTextFile: false,
    writeTextFile: false,
  },
  terminal: false,
} satisfies acp.ClientCapabilities;

export const SDK_RUNTIME_CLIENT_CAPABILITIES = {
  fs: {
    readTextFile: true,
    writeTextFile: true,
  },
  terminal: true,
} satisfies acp.ClientCapabilities;

export const SDK_CLIENT_CAPABILITIES = SDK_RUNTIME_CLIENT_CAPABILITIES;

export type SdkPermissionDecision = "allow" | "deny" | "cancelled";

export type SdkMappedPermissionRequest = {
  id: string;
  optionIds: Partial<Record<PermissionDecision, string>>;
  allowOptionId?: string;
  denyOptionId?: string;
  request: PermissionRequest;
};

export function mapTillerMcpServersToSdkMcpServers(mcpServers: AcpMcpServer[] = []): acp.McpServer[] {
  return mcpServers.map((server) => ({
    name: server.name,
    command: server.command,
    args: server.args ?? [],
    env: Object.entries(server.env ?? {}).map(([name, value]) => ({ name, value })),
  }));
}

export function mapPromptContentToSdkBlocks(content: AgentPromptContent[]): acp.ContentBlock[] {
  return content.map((item) => {
    if (item.type !== "image") {
      return {
        type: "text",
        text: item.text,
      };
    }
    if (!item.data) {
      throw new Error("Cannot send reference-only image content to ACP provider");
    }
    return {
      type: "image",
      data: item.data,
      mimeType: item.mimeType,
      ...(item.uri ? { uri: item.uri } : {}),
    };
  });
}

export function mapSdkPermissionRequest(params: acp.RequestPermissionRequest, id: string, cwd: string): SdkMappedPermissionRequest {
  const optionIds: Partial<Record<PermissionDecision, string>> = {};
  const rawOptions: PermissionRequestOption[] = [];

  for (const option of params.options ?? []) {
    const decision = resolvePermissionOptionDecision(option, optionIds);
    if (!decision) {
      continue;
    }
    rawOptions.push({ decision, label: option.name });
    optionIds[decision] ??= option.optionId;
  }

  const options = normalizePermissionRequestOptions(rawOptions);

  const allowOptionId = optionIds.allow ?? optionIds.allow_session ?? optionIds.allow_always;
  const denyOptionId = optionIds.deny ?? optionIds.deny_always;
  const title = stringFrom(params.toolCall.title);
  const rawInput = stringFrom(params.toolCall.rawInput);
  const command = [title, rawInput].filter(Boolean).join(" :: ") || "ACP permission request";
  const reason = [params.toolCall.kind, title].filter(Boolean).join(" · ") || "ACP agent requested permission.";

  return {
    id,
    optionIds,
    allowOptionId,
    denyOptionId,
    request: {
      id,
      toolCallId: params.toolCall.toolCallId,
      command,
      reason,
      cwd,
      ...(options.length ? { options } : {}),
    },
  };
}

function resolvePermissionOptionDecision(
  option: acp.RequestPermissionRequest["options"][number],
  optionIds: Partial<Record<PermissionDecision, string>>,
): PermissionDecision | null {
  switch (option.kind) {
    case "allow_once":
      return "allow";
    case "allow_always":
      return isSessionPermissionOption(option) && !optionIds.allow_session
        ? "allow_session"
        : "allow_always";
    case "reject_once":
      return "deny";
    case "reject_always":
      return "deny_always";
    default:
      return null;
  }
}

const PERMISSION_ACTION_LABELS: Record<PermissionDecision, string> = {
  allow: "本次允许",
  allow_session: "本会话允许",
  allow_always: "全局允许",
  deny: "拒绝",
  deny_always: "始终拒绝",
};

const PERMISSION_ACTION_ORDER: PermissionDecision[] = [
  "allow",
  "allow_session",
  "allow_always",
  "deny",
  "deny_always",
];

export function normalizePermissionRequestOptions(
  options: PermissionRequestOption[],
): PermissionRequestOption[] {
  const byDecision = new Map<PermissionDecision, PermissionRequestOption>();
  for (const option of options) {
    if (byDecision.has(option.decision)) continue;
    // 保留 SDK 给出的原始 label，只有当 label 为空/缺失时回退到中文常量。
    const label = option.label?.trim() ? option.label : PERMISSION_ACTION_LABELS[option.decision];
    byDecision.set(option.decision, { decision: option.decision, label });
  }
  return PERMISSION_ACTION_ORDER.flatMap((decision) => {
    const option = byDecision.get(decision);
    return option ? [option] : [];
  });
}

function isSessionPermissionOption(
  option: acp.RequestPermissionRequest["options"][number],
): boolean {
  return /session|current|this|会话|当前|本次/iu.test(
    `${option.optionId} ${option.name}`,
  );
}

function stringFrom(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === undefined || value === null) {
    return undefined;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
