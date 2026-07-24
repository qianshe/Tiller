export function normalizeQuotedSelection(text: string) {
  const excerpt = text.trim();
  if (!excerpt) {
    return null;
  }
  return { excerpt };
}
