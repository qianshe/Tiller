import { Badge, Separator } from "../../../shared/ui";
import { MarkdownMessage } from "../../../shared/ui/markdown";

const PHASE_PATTERN = /^\[(🌳木|🔥火|🏔️土|⚔️金|💧水|🔁知)\]\s*(.*)$/u;
const SECTION_PATTERN = /^\*\*(状态|目标|内容|产物|根因|差异|验证|后续|风险)\*\*\s*[:：]\s*([\s\S]*)$/u;

type StructuredAssistantMessage = {
  phase: { badge: string; title: string } | null;
  sections: StructuredMessageSection[];
};

type StructuredMessageSection = {
  label: string;
  body: string;
};

export function StructuredAssistantMessage({ text }: { text: string }) {
  const message = parseStructuredAssistantMessage(text);
  if (!message) {
    return <MarkdownMessage text={text} />;
  }

  return (
    <div className="structured-assistant-message grid max-w-full min-w-0 gap-3">
      <div className="flex flex-row items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {message.phase ? (
              <Badge className="structured-message-phase shrink-0" variant="default">
                {message.phase.badge}
              </Badge>
            ) : null}
            <span className="truncate text-sm font-semibold text-foreground">
              {message.phase?.title || "结构化回复"}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">Assistant response</span>
        </div>
      </div>
      <Separator />
      <div className="grid gap-3">
        {message.sections.map((section, index) => (
          <section
            key={`${section.label}-${index}`}
            className="structured-message-section min-w-0 rounded-xl bg-surface-sunken p-3 text-sm text-foreground"
          >
            <div className="mb-2 flex items-center gap-2">
              <Badge variant="secondary" className="px-2 py-0.5 text-[10px]">
                {section.label}
              </Badge>
            </div>
            <div className="structured-message-section-body min-w-0 [overflow-wrap:anywhere] [&_.markdown-table-scroll]:max-w-full [&_.markdown-table-scroll]:overflow-x-auto [&_.markdown-table-scroll]:overflow-y-hidden">
              <MarkdownMessage text={section.body} />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export function parseStructuredAssistantMessage(
  text: string,
): StructuredAssistantMessage | null {
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (!blocks.length) {
    return null;
  }

  let phase: StructuredAssistantMessage["phase"] = null;
  const sections: StructuredMessageSection[] = [];

  for (const block of blocks) {
    const phaseMatch = PHASE_PATTERN.exec(block);
    if (phaseMatch) {
      phase = {
        badge: phaseMatch[1] ?? "阶段",
        title: phaseMatch[2]?.trim() || "阶段更新",
      };
      continue;
    }

    const sectionMatch = SECTION_PATTERN.exec(block);
    if (sectionMatch) {
      sections.push({
        label: sectionMatch[1] ?? "内容",
        body: sectionMatch[2]?.trim() || "—",
      });
      continue;
    }

    const lastSection = sections.at(-1);
    if (lastSection) {
      lastSection.body = `${lastSection.body}\n\n${block}`;
    }
  }

  if (!phase && !sections.length) {
    return null;
  }

  return { phase, sections };
}
