import type {
  PermissionDecision,
  PermissionRequest,
  PermissionRequestOption,
} from "@tiller/shared";

export type MissionPermissionCommandDisplay = {
  title: string;
  detail: string | null;
};

type JsonRecord = Record<string, unknown>;

export type MissionPermissionDrawerCopy = {
  permissionRequest: string;
  allowOnce: string;
  deny: string;
};

type MissionPermissionDrawerProps = {
  request: PermissionRequest;
  copy: MissionPermissionDrawerCopy;
  showWorkspace: boolean;
  onRespond: (decision: PermissionDecision) => void;
};

export function resolvePermissionCommandDisplay(
  command: string,
): MissionPermissionCommandDisplay {
  const [label, detailSource] = splitCommand(command);
  const parsedDetail = parseJsonRecord(detailSource);
  const shellCommand = resolveShellCommand(parsedDetail);
  if (shellCommand) {
    return { title: shellCommand, detail: null };
  }

  const mcpName = resolveMcpToolName(parsedDetail);
  if (mcpName) {
    return { title: `MCP · ${mcpName}`, detail: null };
  }

  if (detailSource && isLikelyShellPermissionLabel(label)) {
    return { title: detailSource, detail: null };
  }

  return { title: label || command, detail: detailSource };
}

function splitCommand(command: string): [string, string | null] {
  const separator = " :: ";
  const separatorIndex = command.indexOf(separator);
  if (separatorIndex === -1) {
    return [command.trim(), null];
  }

  return [
    command.slice(0, separatorIndex).trim(),
    command.slice(separatorIndex + separator.length).trim() || null,
  ];
}

function parseJsonRecord(value: string | null): JsonRecord | null {
  if (!value) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return isJsonRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveShellCommand(record: JsonRecord | null): string | null {
  const command = record?.command;
  if (typeof command === "string") {
    return command;
  }
  if (Array.isArray(command)) {
    return command.map(String).join(" ");
  }
  return null;
}

function resolveMcpToolName(record: JsonRecord | null): string | null {
  if (!record) {
    return null;
  }
  const request = isJsonRecord(record.request) ? record.request : null;
  const serverName = firstString(
    record.server_name,
    record.serverName,
    record.server,
    request?.server_name,
    request?.serverName,
    request?.server,
  );
  const toolName = firstString(
    request?.name,
    request?.tool_name,
    request?.toolName,
    request?.tool,
    request?.method,
    record.tool_name,
    record.toolName,
    record.tool,
    record.method,
  );

  if (serverName && toolName) {
    return toolName.includes("/") ? toolName : `${serverName}/${toolName}`;
  }
  return toolName ?? serverName;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function isLikelyShellPermissionLabel(label: string): boolean {
  return /shell|terminal|command|execute|run/i.test(label);
}

export function resolvePermissionActionLabel(
  option: PermissionRequestOption,
  copy: MissionPermissionDrawerCopy,
): string {
  switch (option.decision) {
    case "allow":
      return copy.allowOnce;
    case "allow_session":
      return "本会话允许";
    case "allow_always":
      return "全局允许";
    case "deny":
      return copy.deny;
    case "deny_always":
      return "始终拒绝";
  }
}

function isAllowDecision(decision: PermissionDecision): boolean {
  return decision.startsWith("allow");
}

/**
 * Permission request drawer pinned below the active mission conversation.
 */
export function MissionPermissionDrawer({
  request,
  copy,
  showWorkspace,
  onRespond,
}: MissionPermissionDrawerProps) {
  const commandDisplay = resolvePermissionCommandDisplay(request.command);
  const permissionOptions = request.options?.length
    ? request.options
    : [
        { decision: "allow" as const, label: copy.allowOnce },
        { decision: "deny" as const, label: copy.deny },
      ];

  return (
    <section
      className="mission-permission-drawer"
      role="region"
      aria-live="polite"
      aria-label={copy.permissionRequest}
    >
      <div className="mission-permission-header">
        <p className="eyebrow">{copy.permissionRequest}</p>
        <strong className="mission-permission-title">
          {commandDisplay.title}
        </strong>
      </div>
      <div className="mission-permission-copy">
        {commandDisplay.detail ? (
          <p className="mission-permission-detail">{commandDisplay.detail}</p>
        ) : null}
        <p className="muted compact mission-permission-reason">{request.reason}</p>
        {showWorkspace ? (
          <p className="subtle compact mission-permission-workspace">
            {request.workspacePath}
          </p>
        ) : null}
      </div>
      <div className="permission-actions mission-permission-actions">
        {permissionOptions.map((option) => (
          <button
            className={isAllowDecision(option.decision) ? "primary" : "secondary"}
            type="button"
            key={`${option.decision}-${option.label}`}
            onClick={() => onRespond(option.decision)}
          >
            {resolvePermissionActionLabel(option, copy)}
          </button>
        ))}
      </div>
    </section>
  );
}
