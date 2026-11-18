export type RequestMode = "chat" | "transcribe" | "product_search";
export type ModeResult =
  | { mode: RequestMode }
  | { error: "quote_extract_unavailable" | "unknown_mode" };

export function resolveRequestMode(value: unknown): ModeResult {
  if (value == null || value === "chat") return { mode: "chat" };
  if (value === "transcribe" || value === "product_search") return { mode: value };
  if (value === "quote_extract") return { error: "quote_extract_unavailable" };
  return { error: "unknown_mode" };
}
