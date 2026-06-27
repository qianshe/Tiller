import codexProviderIconUrl from "../../../shared/assets/provider-icons/codex.svg";
import claudeProviderIconUrl from "../../../shared/assets/provider-icons/claude-code.svg";
import geminiProviderIconUrl from "../../../shared/assets/provider-icons/gemini.svg";

type MissionAgentIconProps = {
  agentName: string;
};

/**
 * Provider icon resolver for mission tree agent rows.
 */
export function MissionAgentIcon({ agentName }: MissionAgentIconProps) {
  const iconUrl = resolveMissionAgentIconUrl(agentName);
  if (iconUrl) {
    return <img src={iconUrl} alt="" aria-hidden="true" />;
  }

  return (
    <span className="mission-tree-agent-initials">
      {resolveMissionAgentInitials(agentName)}
    </span>
  );
}

function resolveMissionAgentInitials(agentName: string) {
  const words = agentName.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])/g) ?? [agentName];
  return (
    words
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase() || "A"
  );
}

function resolveMissionAgentIconUrl(agentName: string) {
  const normalized = agentName.toLowerCase();
  if (normalized.includes("codex") || normalized.includes("openai")) {
    return codexProviderIconUrl;
  }
  if (normalized.includes("claude") || normalized.includes("anthropic")) {
    return claudeProviderIconUrl;
  }
  if (normalized.includes("gemini")) {
    return geminiProviderIconUrl;
  }
  return null;
}
