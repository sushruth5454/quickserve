import { createClient } from "npm:@supabase/supabase-js@2";
import { cancelRetiredLinks, corsHeaders, json, razorpay, RazorpayError, requireEnv } from "../_shared/razorpay.ts";
import {
  recoverSportsCheckoutRace,
  resolveSportsPaymentRequest,
  sportsPaymentPreparation,
  sportsPaymentsEnabled,
} from "./logic.ts";

interface PreparedPayment {
  payment_id: string;
  amount: number;
  purpose: "visit_fee" | "balance" | "fixed" | "package" | "advance" | "milestone" | "final" | "platform_fee" | "addon" | "session";
  short_url: string | null;
  url?: string | null;
  schedule_id?: string | null;
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
    const packId = typeof body.pack_id === "string" ? body.pack_id : null;
    const scheduleId = typeof body.schedule_id === "string" ? body.schedule_id : null;
    const sportsRequest = resolveSportsPaymentRequest(body, user.id);
    if (sportsRequest && "error" in sportsRequest) return json({ error: sportsRequest.error }, 400);
    if (!sportsRequest && !bookingId && !packId) return json({ error: "booking_id or pack_id is required" }, 400);

    let prepared: PreparedPayment | null = null;
    let prepError: { message: string } | null = null;
    if (sportsRequest) {
      const { data: features, error: featureError } = await admin.rpc("get_app_features");
      if (featureError) return json({ error: "sports payment availability could not be checked" }, 503);
      if (!sportsPaymentsEnabled(features)) return json({ error: "Sports online payments are turned off right now." }, 403);
      const preparation = sportsPaymentPreparation(sportsRequest);
      const result = await admin.rpc(preparation.rpc, preparation.args).single<PreparedPayment>();
      prepared = result.data ? { ...result.data, short_url: result.data.url ?? null } : null;
      prepError = result.error;
    } else if (packId) {
      const result = await admin.rpc("prepare_pack_payment", { p_pack_id: packId, p_user_id: user.id })
        .single<PreparedPayment>();
      prepared = result.data;
      prepError = result.error;
    } else {
      const { data: booking } = await admin.from("bookings").select("archetype").eq("id", bookingId).single<{ archetype: string }>();
      const result = booking?.archetype === "time_based"
        ? await admin.rpc("prepare_session_payment", {
            p_booking_id: bookingId,
            p_user_id: user.id,
            p_schedule_id: scheduleId,
          }).single<PreparedPayment>()
        : await (scheduleId
            ? admin.rpc("prepare_schedule_payment", {
                p_booking_id: bookingId,
                p_user_id: user.id,
                p_schedule_id: scheduleId,
              })
            : admin.rpc("prepare_payment", { p_booking_id: bookingId, p_user_id: user.id }))
            .single<PreparedPayment>();
      prepared = result.data;
      prepError = result.error;
    }
    if (prepError || !prepared) return json({ error: prepError?.message ?? "cannot prepare payment" }, 400);

    // Links retired by prepare_payment / change orders must not stay payable.
    // The shared cancellation RPC filters bookings.booking_id; sports retries are retired by their own SQL path.
    if (!sportsRequest) await cancelRetiredLinks(admin, bookingId);

    if (prepared.short_url) {
      return json({ short_url: prepared.short_url, amount: prepared.amount, purpose: prepared.purpose, schedule_id: prepared.schedule_id ?? scheduleId });
    }

    const { data: booking, error: bookingError } = bookingId && !sportsRequest
      ? await admin
          .from("bookings")
          .select("booking_origin")
          .eq("id", bookingId)
          .single<{ booking_origin: "marketplace" | "byo" }>()
      : { data: { booking_origin: "marketplace" as const }, error: null };
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

    // Razorpay Orders + hosted Checkout (payment links are capped at 30 in test mode). The order id is stored in
    // payments.razorpay_link_id, which every downstream step (record_payment_paid, refunds, retirement) keys on.
    // short_url is the hosted checkout page for this order; the app opens it exactly as it opened a payment link.
    const checkoutBase = Deno.env.get("CHECKOUT_PAGE_URL") ?? "https://sushruth5454.github.io/quickserve/checkout/";
    let link: PaymentLink;
    try {
      const order = await razorpay<{ id: string; amount: number }>("/orders", {
        amount: prepared.amount,
        currency: "INR",
        receipt: prepared.payment_id,
        notes: {
          ...(sportsRequest ? { sports_booking_id: sportsRequest.bookingId } : { booking_id: bookingId }),
          pack_id: packId,
          payment_id: prepared.payment_id,
          purpose: prepared.purpose,
          ...(prepared.schedule_id ?? scheduleId ? { schedule_id: prepared.schedule_id ?? scheduleId } : {}),
        },
      });
      const description = prepared.purpose === "visit_fee"
        ? "QuickServe visit fee"
        : prepared.purpose === "addon"
          ? "QuickServe approved add-on"
          : "QuickServe job payment";
      const params = new URLSearchParams({
        o: order.id,
        k: requireEnv("RAZORPAY_KEY_ID"),
        a: String(order.amount),
        d: description,
        v: `${supabaseUrl}/functions/v1/verify-payment`,
        ...(account?.phone ? { c: account.phone } : {}),
      });
      link = { id: order.id, short_url: `${checkoutBase}?${params.toString()}` };
    } catch (e) {
      await admin.from("payments").update({ status: "failed" }).eq("id", prepared.payment_id);
      console.error(e);
      // 401/429 are account-side (bad keys, rate limits): the customer can only retry later.
      if (e instanceof RazorpayError && (e.status === 401 || e.status === 429)) {
        return json({ error: "Online payments are temporarily unavailable. Please try again in a little while." }, 503);
      }
      return json({ error: "payment provider error" }, 502);
    }

    // Attach only while this attempt is still live: a concurrent checkout may have retired it while the link
    // was being created. A link that lost the race is queued for cancellation and the customer retries.
    const attachQuery = admin
      .from("payments")
      .update({ razorpay_link_id: link.id, short_url: link.short_url })
      .eq("id", prepared.payment_id)
      .eq("status", "created");
    const { data: attached, error: updError } = sportsRequest
      ? await attachQuery.is("razorpay_link_id", null).select("id")
      : await attachQuery.select("id");
    if (updError) throw updError;
    if (!attached?.length) {
      if (sportsRequest) {
        const winner = await recoverSportsCheckoutRace(
          {
            bookingId: sportsRequest.bookingId,
            purpose: prepared.purpose,
            amount: prepared.amount,
            orderId: link.id,
            shortUrl: link.short_url,
          },
          async (attempt) => {
            const { error } = await admin.from("payments").insert(attempt);
            if (error) throw error;
          },
          async () => {
            const preparation = sportsPaymentPreparation(sportsRequest);
            const { data, error } = await admin.rpc(preparation.rpc, preparation.args).single<PreparedPayment>();
            if (error) throw error;
            if (!data || typeof data.url !== "string" || !data.url) return null;
            return { short_url: data.url, amount: data.amount, purpose: data.purpose };
          },
        );
        if (winner) {
          return json({ short_url: winner.short_url, amount: winner.amount, purpose: winner.purpose });
        }
        return json({ error: "This sports payment was updated in another window. Please tap Pay again." }, 409);
      }

      await admin.from("payments")
        .update({ razorpay_link_id: link.id, short_url: link.short_url, cancel_link_pending: true })
        .eq("id", prepared.payment_id);
      if (!sportsRequest) await cancelRetiredLinks(admin, bookingId);
      return json({ error: "This payment was updated in another window. Please tap Pay again." }, 409);
    }

    return json({
      short_url: link.short_url,
      amount: prepared.amount,
      purpose: prepared.purpose,
      schedule_id: prepared.schedule_id ?? scheduleId,
    });
  } catch (e) {
    console.error(e);
    return json({ error: "internal error" }, 500);
  }
});
