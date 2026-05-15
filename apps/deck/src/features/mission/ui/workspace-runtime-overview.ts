type RuntimeOverviewItem = {
  id: string;
  agentId?: string;
  cwd?: string;
  children?: Array<{ id?: string }>;
  status?: string;
  model?: string;
  canReconnect?: boolean;
  canConnect?: boolean;
  [key: string]: unknown;
};

export function dedupeRuntimeOverviewItems<T extends RuntimeOverviewItem>(items: T[]): T[] {
  const byAgentCwd = new Map<string, T>();
  const passthrough: T[] = [];

  for (const item of items) {
    const key = runtimeOverviewIdentityKey(item);
    if (!key) {
      passthrough.push(item);
      continue;
    }

    const existing = byAgentCwd.get(key);
    if (!existing) {
      byAgentCwd.set(key, item);
      continue;
    }

    byAgentCwd.set(key, mergeRuntimeOverviewItems(existing, item));
  }

  return [...byAgentCwd.values(), ...passthrough];
}

function runtimeOverviewIdentityKey(item: RuntimeOverviewItem) {
  if (!item.agentId || !item.cwd) {
    return null;
  }
  return `${item.agentId}::${normalizeWorktreePath(item.cwd)}`;
}

function mergeRuntimeOverviewItems<T extends RuntimeOverviewItem>(left: T, right: T): T {
  const preferred = preferRuntimeOverviewItem(left, right);
  const fallback = preferred === left ? right : left;
  return {
    ...fallback,
    ...preferred,
    children: mergeRuntimeChildren(preferred.children, fallback.children),
    canReconnect: Boolean(preferred.canReconnect || fallback.canReconnect),
    canConnect: Boolean(preferred.canConnect || fallback.canConnect) &&
      !Boolean(preferred.canReconnect || fallback.canReconnect),
  };
}

function preferRuntimeOverviewItem<T extends RuntimeOverviewItem>(left: T, right: T): T {
  const leftChildren = left.children?.length ?? 0;
  const rightChildren = right.children?.length ?? 0;
  if (leftChildren !== rightChildren) {
    return leftChildren > rightChildren ? left : right;
  }
  if (Boolean(left.model) !== Boolean(right.model)) {
    return left.model ? left : right;
  }
  if (left.status !== "未连接" && right.status === "未连接") {
    return left;
  }
  if (right.status !== "未连接" && left.status === "未连接") {
    return right;
  }
  return left;
}

function mergeRuntimeChildren<T extends { id?: string }>(primary: T[] = [], secondary: T[] = []) {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const child of [...primary, ...secondary]) {
    const key = child.id;
    if (key && seen.has(key)) {
      continue;
    }
    if (key) {
      seen.add(key);
    }
    merged.push(child);
  }
  return merged;
}

function normalizeWorktreePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/u, "").toLowerCase();
}
