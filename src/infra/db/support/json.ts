export function parseJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) {
    return [];
  }

  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}
