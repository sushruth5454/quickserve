export function cleanSpecs(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, text]) => [key, text.trim()] as const)
      .filter(([, text]) => text.length > 0),
  );
}
