const REDACTED_FIELD_PATTERN = /^(text|content|output|patch|prompt|stdout|stderr|command|arguments|rawInput|rawOutput|reason|payload|providerPayload)$/iu;

export function redactLogFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactLogFields(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    redacted[key] = REDACTED_FIELD_PATTERN.test(key)
      ? redactLogValue(child)
      : redactLogFields(child);
  }
  return redacted;
}

function redactLogValue(value: unknown) {
  return typeof value === "string" ? `[redacted chars=${value.length}]` : "[redacted]";
}
