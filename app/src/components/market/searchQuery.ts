export function normalizeQuery(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function isSearchable(value: string): boolean {
  return normalizeQuery(value).length >= 2;
}
