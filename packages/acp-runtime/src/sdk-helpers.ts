import * as acp from "@agentclientprotocol/sdk";
import type { AcpMcpServer, AgentPromptContent, PermissionRequest } from "@tiller/shared";

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
  return content.map((item) => item.type === "image"
    ? {
        type: "image",
        data: item.data,
        mimeType: item.mimeType,
        ...(item.uri ? { uri: item.uri } : {}),
      }
    : {
        type: "text",
        text: item.text,
      });
}

export function mapSdkPermissionRequest(params: acp.RequestPermissionRequest, id: string, workspacePath: string): SdkMappedPermissionRequest {
  const allowOptionId = params.options.find((option) => option.kind.startsWith("allow"))?.optionId;
  const denyOptionId = params.options.find((option) => option.kind.startsWith("reject"))?.optionId;
  const title = stringFrom(params.toolCall.title);
  const rawInput = stringFrom(params.toolCall.rawInput);
  const command = [title, rawInput].filter(Boolean).join(" :: ") || "ACP permission request";
  const reason = [params.toolCall.kind, title].filter(Boolean).join(" · ") || "ACP agent requested permission.";

  return {
    id,
    allowOptionId,
    denyOptionId,
    request: {
      id,
      command,
      reason,
      workspacePath,
    },
  };
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
