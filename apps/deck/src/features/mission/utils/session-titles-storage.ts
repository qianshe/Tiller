const SESSION_TITLES_STORAGE_KEY = "tiller.session-titles";

export function readSessionTitles(): Record<string, string> {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(SESSION_TITLES_STORAGE_KEY) ?? "{}",
    );
    return parsed && typeof parsed === "object"
      ? Object.fromEntries(
          Object.entries(parsed).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : {};
  } catch {
    return {};
  }
}

export function writeSessionTitles(titles: Record<string, string>) {
  window.localStorage.setItem(
    SESSION_TITLES_STORAGE_KEY,
    JSON.stringify(titles),
  );
}
