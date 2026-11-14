/**
 * provider-payout-account (JWT verified at the gateway): the provider's payout beneficiary on the active rail.
 *  POST {action:"status"}  -> rail + masked account record (no gateway call)
 *  POST {action:"submit", legal_name, pan, email, account_number, confirm_account_number, ifsc, address?}
 *  POST {action:"refresh"} -> polls the gateway (and resumes a blocked bank validation)
 * PAN and the full account number are sent to Razorpay only and never stored or logged (docs/08 §6).
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, json, requireEnv } from "../_shared/razorpay.ts";
import { GatewayError, isGatewayUnavailable, type RailName } from "../_shared/payout-rail.ts";
import {
  activeRail,
  applyResult,
  PAYOUT_ACCOUNT_COLUMNS,
  persistIds,
  railsFromEnv,
  recordUnavailable,
  refreshBeneficiary,
  type PayoutAccountRow,
} from "../_shared/payout-beneficiary.ts";
import { friendlyGatewayError, maskAccount, parseSubmit, type SubmitBody } from "./logic.ts";

const UNAVAILABLE = {
  state: "unavailable",
  message: "Payouts setup is temporarily unavailable. Your profile is saved and we'll notify you when you can finish this step.",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "unauthorized" }, 401);
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "unauthorized" }, 401);
    const uid = userData.user.id;

    const body = (await req.json().catch(() => ({}))) as SubmitBody & { action?: string };
    const action = body.action ?? "status";

    const { data: provider } = await admin.from("providers").select("id").eq("id", uid).maybeSingle();
    if (!provider) return json({ error: "Create your provider profile first." }, 400);

    const { data: existingRaw } = await admin.from("provider_payout_accounts").select(PAYOUT_ACCOUNT_COLUMNS).eq("provider_id", uid).maybeSingle();
    const existing = existingRaw as PayoutAccountRow | null;
    const hasGatewayIds = !!(existing?.razorpay_account_id || existing?.contact_id || existing?.fund_account_id);
    // In-flight beneficiaries stay on the rail they started on; new ones use the configured rail.
    const rail: RailName = hasGatewayIds && existing ? existing.rail : await activeRail(admin);
    const rails = railsFromEnv();

    if (action === "status") {
      return json({ rail, account: existing ? { ...existing, stakeholder_id: undefined } : null });
    }

    if (action === "refresh") {
      if (!existing || !hasGatewayIds) return json({ rail, state: "not_started" });
      try {
        const r = await refreshBeneficiary(admin, rails, existing);
        if (r.state === "unavailable") return json({ rail, ...UNAVAILABLE });
        return json({ rail, ...r });
      } catch (e) {
        console.error("payout refresh failed", uid, e instanceof Error ? e.message : e);
        return json({ error: "Could not reach our payment partner. Try again in a few minutes." }, 502);
      }
    }

    if (action !== "submit") return json({ error: "unknown action" }, 400);

    const { data: account } = await admin.from("private_user_accounts").select("phone").eq("user_id", uid).maybeSingle();
    const parsed = parseSubmit(body, { providerId: uid, phone: account?.phone ?? "", rail });
    if (!parsed.ok) return json({ error: "Please fix the highlighted fields.", fields: parsed.errors }, 422);
    const input = parsed.input;
    if (input.phone.length < 8) return json({ error: "Your account has no verified phone number." }, 400);

    const now = new Date().toISOString();
    const { error: upsertError } = await admin.from("provider_payout_accounts").upsert(
      {
        provider_id: uid,
        rail,
        beneficiary_name: input.legalName,
        bank_last4: maskAccount(input.accountNumber),
        ifsc: input.ifsc,
        email: input.email,
        activation_status: existing?.activation_status === "activated" ? "activated" : "requested",
        last_error: null,
        updated_at: now,
      },
      { onConflict: "provider_id" },
    );
    if (upsertError) throw new Error(upsertError.message);

    try {
      const result = await rails[rail].onboardBeneficiary(input, existing ?? {}, persistIds(admin, uid));
      const kyc = await applyResult(admin, uid, result);
      await admin.from("provider_onboarding_events").insert({ provider_id: uid, kind: "payout_submitted", details: { rail, status: result.status } });
      return json({ rail, state: "submitted", gateway_status: result.status, kyc_status: kyc, requirements: result.requirements });
    } catch (e) {
      if (isGatewayUnavailable(e)) {
        await recordUnavailable(admin, uid, rail, e);
        return json({ rail, ...UNAVAILABLE });
      }
      if (e instanceof GatewayError && !e.ambiguous) {
        const message = friendlyGatewayError(e.field, e.description);
        await admin.from("provider_payout_accounts").update({ last_error: message, last_error_at: now }).eq("provider_id", uid);
        await admin.from("provider_onboarding_events").insert({ provider_id: uid, kind: "payout_setup_failed", details: { rail, status: e.status } });
        console.warn("payout submit rejected", rail, uid, e.status);
        return json({ error: message }, 422);
      }
      // Ambiguous (timeout / 5xx): ids created so far are persisted, so a retry resumes without duplicates.
      console.error("payout submit ambiguous failure", rail, uid, e instanceof Error ? e.message : e);
      return json({ error: "Our payment partner did not respond. Your details are safe — please try again." }, 502);
    }
  } catch (e) {
    console.error("provider-payout-account", e instanceof Error ? e.message : e);
    return json({ error: "internal error" }, 500);
  }
});
