import { assertEquals } from "jsr:@std/assert@1";
import { visualPiiRedactionReady } from "./image.ts";

Deno.test("customer images stay blocked until visible phone and address text can be redacted", () => {
  assertEquals(visualPiiRedactionReady, false);
});
