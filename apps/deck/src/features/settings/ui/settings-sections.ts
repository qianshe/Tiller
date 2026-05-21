import type { TillerIconName } from "@/shared/ui";

export type SettingsSectionId =
  | "appearance"
  | "language"
  | "motion"
  | "panels"
  | "enhancer"
  | "privacy"
  | "about";

export type SettingsSectionMeta = {
  id: SettingsSectionId;
  icon: TillerIconName;
  label: string;
  desc: string;
};

export const SETTINGS_SECTIONS: SettingsSectionMeta[] = [
  { id: "appearance", icon: "board", label: "外观", desc: "主题 · 密度 · 字体" },
  { id: "language", icon: "globe", label: "语言与区域", desc: "中文 / English" },
  { id: "motion", icon: "activity", label: "动效", desc: "减少过渡动画" },
  { id: "panels", icon: "terminal", label: "技术面板", desc: "诊断与辅助信息默认状态" },
  { id: "enhancer", icon: "sparkle", label: "Prompt 增强", desc: "OpenAI-compatible LLM 增强器" },
  { id: "privacy", icon: "shield", label: "隐私与日志", desc: "本地优先与敏感信息边界" },
  { id: "about", icon: "fileText", label: "关于", desc: "Tiller Deck 运行说明" },
];
