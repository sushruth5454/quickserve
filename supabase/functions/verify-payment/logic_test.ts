import { assertEquals } from "jsr:@std/assert@1";
import { verificationOutcome, verifyCheckoutSignature } from "./logic.ts";

const secret = "\x0b".repeat(20);
const signature = "d966a533315c3a66bbfc241967cbd6409f5cca942795a24d610f55847aab6ccf";

Deno.test("checkout signature verification accepts the expected HMAC and rejects invalid inputs", async () => {
  assertEquals(await verifyCheckoutSignature("order_1", "pay_1", signature, secret), true);
  assertEquals(await verifyCheckoutSignature("order_1", "pay_1", `${signature.slice(0, -1)}0`, secret), false);
  assertEquals(await verifyCheckoutSignature("order_1", "pay_1", signature, "wrong secret"), false);
  assertEquals(await verifyCheckoutSignature("", "There", signature, secret), false);
  assertEquals(await verifyCheckoutSignature("Hi ", "", signature, secret), false);
  assertEquals(await verifyCheckoutSignature("Hi ", "There", "", secret), false);
  assertEquals(await verifyCheckoutSignature("Hi ", "There", signature, ""), false);
});

Deno.test("MN-CHECKOUT-CAPTURE-VS-BOOKED maps recorder results without treating unknown as applied", () => {
  assertEquals(verificationOutcome({ ok: true }), "captured_applied");
  assertEquals(verificationOutcome({ ok: true, refund: true }), "captured_refund_queued");
  assertEquals(verificationOutcome({ ok: false, exception: true }), "review_required");
  assertEquals(verificationOutcome({ ok: false }), "confirmation_pending");
  assertEquals(verificationOutcome(null), "confirmation_pending");
  assertEquals(verificationOutcome(undefined), "confirmation_pending");
});

Deno.test("MN-CHECKOUT-REFUND-REVIEW retains both facts from a combined recorder result", () => {
  const recorderResult = { ok: true, refund: true, exception: true };
  const actual = verificationOutcome(recorderResult);
  assertEquals(
    actual,
    "captured_refund_queued_review_required",
    `recorderResult=${JSON.stringify(recorderResult)} outcome=${JSON.stringify(actual)}`,
  );
});
