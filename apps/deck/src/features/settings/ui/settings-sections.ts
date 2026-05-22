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
  { id: "motion", icon: "activity", label: "动效", desc: "减少动效偏好" },
  { id: "panels", icon: "terminal", label: "技术面板", desc: "Logbook / Diff / 调试" },
  { id: "enhancer", icon: "sparkle", label: "Prompt 增强", desc: "LLM 接入 · 模型" },
  { id: "privacy", icon: "shield", label: "隐私与日志", desc: "数据保留策略" },
  { id: "about", icon: "fileText", label: "关于", desc: "版本 · 许可证" },
];
