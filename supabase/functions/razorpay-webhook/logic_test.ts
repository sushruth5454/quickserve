import { assertEquals } from "jsr:@std/assert@1";
import { verifyWebhook } from "./logic.ts";

const secret = "\x0b".repeat(20);
const signature = "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7";

Deno.test("webhook signature verification supports rotated secrets and rejects invalid inputs", async () => {
  assertEquals(await verifyWebhook("Hi There", signature, ["old secret", secret]), true);
  assertEquals(await verifyWebhook("Hi There", signature, [secret]), true);
  assertEquals(await verifyWebhook("Hi There", "", [secret]), false);
  assertEquals(await verifyWebhook("Hi There", signature, []), false);
  assertEquals(await verifyWebhook("Hi There", signature, [""]), false);
  assertEquals(await verifyWebhook("Hi There", signature, ["wrong secret"]), false);
  assertEquals(await verifyWebhook("different body", signature, [secret]), false);
});
