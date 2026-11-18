import { assertEquals } from "jsr:@std/assert@1";
import { resolveRequestMode } from "./request_mode.ts";

Deno.test("quote extraction is rejected before any image mode can be prepared", () => {
  assertEquals(resolveRequestMode("quote_extract"), { error: "quote_extract_unavailable" });
});

Deno.test("only known assistant modes are accepted", () => {
  assertEquals(resolveRequestMode(undefined), { mode: "chat" });
  assertEquals(resolveRequestMode("product_search"), { mode: "product_search" });
  assertEquals(resolveRequestMode("transcribe"), { mode: "transcribe" });
  assertEquals(resolveRequestMode("unexpected"), { error: "unknown_mode" });
});
