export type DeckLanguage = "zh-CN" | "en-US";

export function isDeckLanguage(value: unknown): value is DeckLanguage {
  return value === "zh-CN" || value === "en-US";
}
