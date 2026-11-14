/**
 * Provider payout beneficiary orchestration shared by the provider-payout-account Edge Function (submit / refresh)
 * and the release-payouts cron (resumes validations that were blocked while the gateway product was unavailable).
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  GatewayError,
  isGatewayUnavailable,
  railFor,
  razorpayHttp,
  type BeneficiaryIds,
  type OnboardResult,
  type PayoutRail,
  type RailName,
} from "./payout-rail.ts";

export const PAYOUT_ACCOUNT_COLUMNS =
  "provider_id, rail, razorpay_account_id, stakeholder_id, product_id, contact_id, fund_account_id, validation_id, beneficiary_name, activation_status, last_error";

export interface PayoutAccountRow extends BeneficiaryIds {
  provider_id: string;
  rail: RailName;
  activation_status: string;
  last_error: string | null;
}

export function railsFromEnv(): Record<RailName, PayoutRail> {
  const keyId = Deno.env.get("RAZORPAY_KEY_ID") ?? "";
  const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET") ?? "";
  const http = razorpayHttp(keyId, keySecret);
  const accountNumber = Deno.env.get("RAZORPAYX_ACCOUNT_NUMBER") || null;
  return { route: railFor("route", http, accountNumber), payouts: railFor("payouts", http, accountNumber) };
}

export async function activeRail(admin: SupabaseClient): Promise<RailName> {
  const { data } = await admin.rpc("get_payout_rail");
  return data === "route" ? "route" : "payouts";
}

export function persistIds(admin: SupabaseClient, providerId: string) {
  return async (ids: BeneficiaryIds) => {
    const { error } = await admin.from("provider_payout_accounts").update({ ...ids, updated_at: new Date().toISOString() }).eq("provider_id", providerId);
    if (error) throw new Error(`persist payout ids failed: ${error.message}`);
  };
}

export async function logOnboardingEvent(admin: SupabaseClient, providerId: string, kind: string, details: Record<string, unknown>) {
  const { error } = await admin.from("provider_onboarding_events").insert({ provider_id: providerId, kind, details });
  if (error) console.error("onboarding event insert failed", kind, error.message);
}

/** Applies a gateway result: kyc_status via the single SQL sync function, plus the name-match score. */
export async function applyResult(admin: SupabaseClient, providerId: string, r: OnboardResult): Promise<string | null> {
  const { data, error } = await admin.rpc("sync_provider_payout_status", {
    p_account_id: r.syncId,
    p_status: r.status,
    p_requirements: r.requirements,
    p_event_at: new Date().toISOString(),
  });
  if (error) throw new Error(`sync_provider_payout_status failed: ${error.message}`);
  await admin
    .from("provider_payout_accounts")
    .update({ last_error: null, name_match_score: r.nameMatchScore ?? null, updated_at: new Date().toISOString() })
    .eq("provider_id", providerId);
  return (data as { kyc_status?: string } | null)?.kyc_status ?? null;
}

/** Gateway product not enabled / not activated on our account: provider sees "temporarily unavailable"; admins see
 * the event + function logs. */
export async function recordUnavailable(admin: SupabaseClient, providerId: string, rail: RailName, e: unknown) {
  const reason = e instanceof GatewayError ? e.description.slice(0, 200) : String(e).slice(0, 200);
  console.error(`[payout-setup-unavailable] rail=${rail} provider=${providerId} reason=${reason}`);
  await admin
    .from("provider_payout_accounts")
    .update({ last_error: "gateway_unavailable", last_error_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("provider_id", providerId);
  await logOnboardingEvent(admin, providerId, "payout_setup_failed", { rail, reason, unavailable: true });
}

/** Polls the gateway for a stored beneficiary (and resumes a blocked validation). */
export async function refreshBeneficiary(
  admin: SupabaseClient,
  rails: Record<RailName, PayoutRail>,
  row: PayoutAccountRow,
): Promise<{ state: "updated"; kyc_status: string | null } | { state: "unavailable" } | { state: "nothing_to_refresh" }> {
  const rail = rails[row.rail];
  try {
    const r = await rail.getStatus(row, persistIds(admin, row.provider_id));
    if (!r) return { state: "nothing_to_refresh" };
    return { state: "updated", kyc_status: await applyResult(admin, row.provider_id, r) };
  } catch (e) {
    if (isGatewayUnavailable(e)) {
      await recordUnavailable(admin, row.provider_id, row.rail, e);
      return { state: "unavailable" };
    }
    throw e;
  }
}
