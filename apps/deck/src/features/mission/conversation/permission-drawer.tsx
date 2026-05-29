import type {
  PermissionDecision,
  PermissionRequest,
  PermissionRequestOption,
} from "@tiller/shared";
import { Button } from "../../../shared/ui";

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
  showWorktree: boolean;
  fallbackToolTitle?: string | null;
  resolving?: boolean;
  onRespond: (decision: PermissionDecision) => void;
};

export function resolvePermissionCommandDisplay(
  command: string,
  fallbackToolTitle?: string | null,
): MissionPermissionCommandDisplay {
  const [label, detailSource] = splitCommand(command);
  const parsedDetail = parseJsonRecord(detailSource);
  const shellCommand = resolveShellCommand(parsedDetail);
  if (shellCommand) {
    return buildPermissionCommandDisplay(shellCommand);
  }

  const mcpName = resolveMcpToolName(parsedDetail);
  if (mcpName) {
    return {
      title: `MCP · ${resolveMcpFallbackToolName(mcpName, fallbackToolTitle)}`,
      detail: null,
    };
  }

  if (detailSource && isLikelyShellPermissionLabel(label)) {
    return buildPermissionCommandDisplay(detailSource);
  }

  return { title: label || command, detail: detailSource };
}

function buildPermissionCommandDisplay(command: string): MissionPermissionCommandDisplay {
  const title = summarizePermissionCommand(command);
  return {
    title,
    detail: title === command ? null : command,
  };
}

function summarizePermissionCommand(command: string): string {
  const normalized = command.replace(/\s+/g, " ").trim();
  if (normalized.length <= 96) {
    return normalized;
  }

  const processMatch = normalized.match(/(?:pwsh|powershell)(?:\.exe)?\b.*?\bStart-Process\b.*?-FilePath\s+([^\s]+)/iu);
  if (processMatch?.[1]) {
    return `PowerShell · Start-Process ${processMatch[1]}`;
  }

  return `${normalized.slice(0, 93)}…`;
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

function resolveMcpFallbackToolName(
  mcpName: string,
  fallbackToolTitle: string | null | undefined,
): string {
  if (mcpName.includes("/") || !fallbackToolTitle) {
    return mcpName;
  }

  const normalizedFallback = fallbackToolTitle
    .replace(/^Tool:\s*/iu, "")
    .replace(/^MCP\s*[·•]\s*/iu, "")
    .trim();
  return normalizedFallback.startsWith(`${mcpName}/`)
    ? normalizedFallback
    : mcpName;
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

export function dedupePermissionOptions(
  options: PermissionRequestOption[],
): PermissionRequestOption[] {
  const seen = new Set<PermissionDecision>();
  return options.filter((option) => {
    if (seen.has(option.decision)) {
      return false;
    }
    seen.add(option.decision);
    return true;
  });
}

/**
 * Permission request drawer pinned below the active mission conversation.
 */
export function MissionPermissionDrawer({
  request,
  copy,
  showWorktree,
  fallbackToolTitle,
  resolving = false,
  onRespond,
}: MissionPermissionDrawerProps) {
  const commandDisplay = resolvePermissionCommandDisplay(
    request.command,
    fallbackToolTitle,
  );
  const permissionOptions = dedupePermissionOptions(
    request.options?.length
      ? request.options
      : [
          { decision: "allow" as const, label: copy.allowOnce },
          { decision: "deny" as const, label: copy.deny },
        ],
  );

  return (
    <section
      className="mission-permission-drawer sticky bottom-2 z-30 grid grid-rows-[auto_auto] gap-3 rounded-[8px] border border-warning/40 bg-surface-elevated p-3 text-foreground shadow-ambient"
      role="region"
      aria-live="polite"
      aria-label={copy.permissionRequest}
      data-testid="mission-permission-drawer"
    >
      <div className="mission-permission-header grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
        <span
          className="mt-0.5 inline-flex h-[var(--control-h-sm)] w-[var(--control-h-sm)] shrink-0 items-center justify-center rounded-full bg-warning/15 text-xs font-semibold text-warning"
          aria-hidden="true"
        >
          !
        </span>
        <div className="grid min-w-0 gap-1">
          <span className="text-meta font-semibold uppercase tracking-wider text-warning">
            {copy.permissionRequest}
          </span>
          <strong className="mission-permission-title max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[0.98rem] font-semibold text-foreground">
            {commandDisplay.title}
          </strong>
        </div>
      </div>
      <div className="mission-permission-copy grid min-h-0 min-w-0 gap-2 text-sm text-muted-foreground">
        {showWorktree ? (
          <p className="mission-permission-worktree break-all text-xs">
            {request.cwd}
          </p>
        ) : (
          <p className="mission-permission-reason text-xs">
            {request.reason}
          </p>
        )}
        {commandDisplay.detail ? (
          <details className="mission-permission-detail min-w-0 max-h-28 max-w-full overflow-hidden rounded-md bg-surface-sunken p-2 font-mono text-xs text-foreground">
            <summary className="cursor-pointer select-none truncate font-sans font-medium text-muted-foreground">
              查看完整命令
            </summary>
            <pre className="mt-2 max-w-full overflow-auto whitespace-pre-wrap break-all leading-relaxed">
              {commandDisplay.detail}
            </pre>
          </details>
        ) : null}
        <div className="permission-actions mission-permission-actions flex flex-wrap items-center justify-end gap-2 self-stretch pb-0">
          {permissionOptions.map((option) => (
            <Button
              variant={isAllowDecision(option.decision) ? "default" : "outline"}
              className="min-h-8 min-w-[72px] px-3 py-1.5 shadow-none"
              type="button"
              key={`${option.decision}-${option.label}`}
              disabled={resolving}
              aria-busy={resolving || undefined}
              onClick={() => onRespond(option.decision)}
            >
              {resolving ? "处理中..." : resolvePermissionActionLabel(option, copy)}
            </Button>
          ))}
        </div>
      </div>
    </section>
  );
}
