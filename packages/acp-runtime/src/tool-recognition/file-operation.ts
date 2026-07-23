export type StructuredFileOperation = {
  kind: "read" | "write";
  path: string;
};

const FILE_PATH_KEYS = [
  "file_path",
  "filePath",
  "relative_path",
  "relativePath",
  "path",
] as const;

const FILE_WRITE_KEYS = [
  "content",
  "body",
  "old_string",
  "new_string",
  "code_edit",
  "repl",
  "new_name",
] as const;

export function classifyStructuredFileOperation(
  input: unknown,
): StructuredFileOperation | null {
  const record = recordFrom(input);
  const path = FILE_PATH_KEYS
    .map((key) => record[key])
    .find((value): value is string => typeof value === "string" && value.length > 0);
  if (!path) {
    return null;
  }
  return {
    kind: FILE_WRITE_KEYS.some((key) => key in record) ? "write" : "read",
    path,
  };
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
