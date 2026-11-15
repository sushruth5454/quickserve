import { createClient } from "npm:@supabase/supabase-js@2";
import { cancelRetiredLinks, corsHeaders, json, razorpay, requireEnv } from "../_shared/razorpay.ts";

interface PreparedPayment {
  payment_id: string;
  amount: number;
  purpose: "visit_fee" | "balance" | "fixed";
  short_url: string | null;
}

interface PaymentLink {
  id: string;
  short_url: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const admin = createClient(supabaseUrl, requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });

    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "unauthorized" }, 401);
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "unauthorized" }, 401);
    const user = userData.user;

    const body = await req.json().catch(() => ({}));
    const bookingId = typeof body.booking_id === "string" ? body.booking_id : null;
    if (!bookingId) return json({ error: "booking_id is required" }, 400);

    const { data: prepared, error: prepError } = await admin
      .rpc("prepare_payment", { p_booking_id: bookingId, p_user_id: user.id })
      .single<PreparedPayment>();
    if (prepError || !prepared) return json({ error: prepError?.message ?? "cannot prepare payment" }, 400);

    // Links retired by prepare_payment / change orders must not stay payable.
    await cancelRetiredLinks(admin, bookingId);

    if (prepared.short_url) {
      return json({ short_url: prepared.short_url, amount: prepared.amount, purpose: prepared.purpose });
    }

    const { data: booking, error: bookingError } = await admin
      .from("bookings")
      .select("booking_origin")
      .eq("id", bookingId)
      .single<{ booking_origin: "marketplace" | "byo" }>();
    if (bookingError || !booking) return json({ error: "booking not found" }, 400);

    // BYO invites are bearer links, shared without provider/customer phone exchange.
    // Never send the customer's phone to Razorpay on this path.
    const { data: account } = booking.booking_origin === "byo"
      ? { data: null }
      : await admin
          .from("private_user_accounts")
          .select("phone")
          .eq("user_id", user.id)
          .maybeSingle();

    const callbackUrl = Deno.env.get("PAYMENT_CALLBACK_URL");
    let link: PaymentLink;
    try {
      link = await razorpay<PaymentLink>("/payment_links", {
        amount: prepared.amount,
        currency: "INR",
        accept_partial: false,
        reference_id: prepared.payment_id,
        description: prepared.purpose === "visit_fee" ? "QuickServe visit fee" : "QuickServe job payment",
        customer: account?.phone ? { contact: account.phone } : undefined,
        notify: { sms: false, email: false },
        reminder_enable: false,
        notes: { booking_id: bookingId, payment_id: prepared.payment_id, purpose: prepared.purpose },
        ...(callbackUrl ? { callback_url: callbackUrl, callback_method: "get" } : {}),
      });
    } catch (e) {
      await admin.from("payments").update({ status: "failed" }).eq("id", prepared.payment_id);
      console.error(e);
      return json({ error: "payment provider error" }, 502);
    }

    const { error: updError } = await admin
      .from("payments")
      .update({ razorpay_link_id: link.id, short_url: link.short_url })
      .eq("id", prepared.payment_id);
    if (updError) throw updError;

    return json({ short_url: link.short_url, amount: prepared.amount, purpose: prepared.purpose });
  } catch (e) {
    console.error(e);
    return json({ error: "internal error" }, 500);
  }
});
