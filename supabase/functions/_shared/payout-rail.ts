/**
 * Payout rails (docs/03-Pricing-Payments-Commission.md §5.1, docs/08-Provider-Onboarding.md §6).
 *
 * One interface, two implementations, selected by app_config.payout_rail and snapshotted per payout_transfers row:
 *  - "route":   Razorpay Route linked account (v2 Accounts API) + transfers from the source payment.
 *  - "payouts": RazorpayX Contact + Fund Account + bank account validation (penny drop) + Payouts API.
 *
 * Official API references (followed exactly):
 *  Route:   https://razorpay.com/docs/api/payments/route/create-linked-account/
 *           https://razorpay.com/docs/api/payments/route/create-stakeholder/
 *           https://razorpay.com/docs/api/payments/route/request-product-config/
 *           https://razorpay.com/docs/api/payments/route/update-product-config/
 *           https://razorpay.com/docs/webhooks/route/   (product.route.under_review | needs_clarification | activated)
 *  RazorpayX: https://razorpay.com/docs/api/x/contacts/create/
 *           https://razorpay.com/docs/api/x/fund-accounts/create/bank-account/
 *           https://razorpay.com/docs/api/x/account-validation/bank-account/
 *           https://razorpay.com/docs/api/x/payouts/create/bank-account/  (X-Payout-Idempotency header)
 *           https://razorpay.com/docs/webhooks/payouts/  https://razorpay.com/docs/webhooks/account-validation/
 *
 * Never logs or persists PAN or full bank account numbers.
 */

export type RailName = "route" | "payouts";
/** Normalised to Route's product activation_status vocabulary (+ "rejected"). */
export type GatewayStatus = "requested" | "under_review" | "needs_clarification" | "activated" | "suspended" | "rejected";

export interface Requirement {
  field_reference: string;
  reason_code: string;
  description?: string;
}

export interface BeneficiaryInput {
  providerId: string;
  legalName: string;
  pan: string;
  email: string;
  phone: string;
  accountNumber: string;
  ifsc: string;
  address?: { street: string; city: string; state: string; postalCode: string };
}

/** Gateway ids already stored in provider_payout_accounts (the idempotency anchor). */
export interface BeneficiaryIds {
  razorpay_account_id?: string | null;
  stakeholder_id?: string | null;
  product_id?: string | null;
  contact_id?: string | null;
  fund_account_id?: string | null;
  validation_id?: string | null;
  beneficiary_name?: string | null;
}

export interface OnboardResult {
  status: GatewayStatus;
  requirements: Requirement[];
  /** The id webhooks reference: linked account (route) or fund account (payouts). */
  syncId: string;
  nameMatchScore?: number | null;
}

export interface ReleaseInput {
  transferId: string;
  payoutId: string;
  bookingId: string;
  amount: number;
  attempts: number;
  idempotencyKey: string;
  razorpayPaymentId: string | null;
  accountId: string | null;
  fundAccountId: string | null;
}

export interface ReleaseResult {
  externalId: string;
  gatewayStatus: string;
}

export interface PayoutRail {
  readonly name: RailName;
  /** Creates or updates the beneficiary. `persist` is called after every gateway object is created so a retry
   * resumes instead of duplicating it. */
  onboardBeneficiary(input: BeneficiaryInput, existing: BeneficiaryIds, persist: (ids: BeneficiaryIds) => Promise<void>): Promise<OnboardResult>;
  getStatus(existing: BeneficiaryIds, persist?: (ids: BeneficiaryIds) => Promise<void>): Promise<OnboardResult | null>;
  release(t: ReleaseInput): Promise<ReleaseResult>;
  /** Route can reverse a transfer; on "payouts" money cannot be pulled back (use provider_receivables). */
  reverse(externalId: string, amount: number, reversalId?: string): Promise<string>;
}

// ---------------------------------------------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------------------------------------------
export class GatewayError extends Error {
  constructor(message: string, readonly status: number, readonly description: string, readonly field: string | null = null) {
    super(message);
  }
  /** Timeout / network / 5xx: the request may have been applied. */
  get ambiguous(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

export type Http = <T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown, headers?: Record<string, string>) => Promise<T>;

export function razorpayHttp(keyId: string, keySecret: string, base = "https://api.razorpay.com", timeoutMs = 15000): Http {
  return async <T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown, headers: Record<string, string> = {}) => {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers: { Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`, "Content-Type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new GatewayError(`${method} ${redactPath(path)} network error: ${e instanceof Error ? e.message : e}`, 0, "network error");
    }
    const text = await res.text();
    if (!res.ok) {
      let description = text.slice(0, 300);
      let field: string | null = null;
      try {
        const err = JSON.parse(text)?.error;
        if (err?.description) description = String(err.description);
        if (err?.field) field = String(err.field);
      } catch {
        // non-JSON error body
      }
      throw new GatewayError(`${method} ${redactPath(path)} failed (${res.status}): ${description}`, res.status, description, field);
    }
    return (text ? JSON.parse(text) : {}) as T;
  };
}

function redactPath(path: string): string {
  return path.split("?")[0];
}

/** Errors that mean "this product is not enabled / not activated on our Razorpay account" (founder action). */
export function isGatewayUnavailable(e: unknown): boolean {
  if (!(e instanceof GatewayError)) return false;
  if (e.status === 401) return true;
  return (e.status === 400 || e.status === 403 || e.status === 404) &&
    /not enabled|not activated|access to requested resource not available|feature not enabled|not available for|account_number.*(required|invalid)|RAZORPAYX_ACCOUNT_NUMBER/i
      .test(e.description);
}

// ---------------------------------------------------------------------------------------------------------------
// Validation helpers (shared by the Edge Function and tests)
// ---------------------------------------------------------------------------------------------------------------
export const PAN_RE = /^[A-Z]{3}P[A-Z][0-9]{4}[A-Z]$/; // individual PAN: 4th character is P
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const ACCOUNT_RE = /^[0-9]{9,18}$/;

const HONORIFICS = new Set(["MR", "MRS", "MS", "MISS", "DR", "SHRI", "SRI", "SMT", "KUMARI", "M/S"]);

export function nameTokens(name: string): string[] {
  return name
    .toUpperCase()
    .replace(/[^A-Z ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !HONORIFICS.has(t));
}

/**
 * Bank registered name vs the PAN name the provider typed. PM default (founder may override): accept when Razorpay's
 * name_match_score >= 70, or when every token of the shorter name appears in the longer one (initials allowed:
 * "R KUMAR" matches "RAVI KUMAR") and at least one full token matches.
 */
export function namesMatch(expected: string, registered: string | null | undefined, score?: number | null): boolean {
  if (typeof score === "number" && score >= 70) return true;
  if (!registered) return false;
  const a = nameTokens(expected);
  const b = nameTokens(registered);
  if (a.length === 0 || b.length === 0) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let full = 0;
  for (const t of short) {
    if (long.includes(t)) {
      full++;
      continue;
    }
    if (t.length === 1 && long.some((l) => l.startsWith(t))) continue;
    return false;
  }
  return full >= 1;
}

// ---------------------------------------------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------------------------------------------
interface ProductConfig {
  id: string;
  activation_status: string;
  requirements?: Requirement[];
}

function routeStatus(s: string | undefined): GatewayStatus {
  switch (s) {
    case "activated":
    case "under_review":
    case "needs_clarification":
    case "suspended":
    case "rejected":
      return s;
    default:
      return "requested";
  }
}

export function routeRail(http: Http): PayoutRail {
  return {
    name: "route",
    async onboardBeneficiary(input, existing, persist) {
      const ids: BeneficiaryIds = { ...existing };
      const a = input.address;
      if (!a) throw new GatewayError("address is required for Route", 400, "address is required");
      const registered = { street1: a.street.slice(0, 100), city: a.city, state: a.state.toUpperCase(), postal_code: a.postalCode, country: "IN" };
      if (!ids.razorpay_account_id) {
        const acc = await http<{ id: string }>("POST", "/v2/accounts", {
          email: input.email,
          phone: input.phone,
          type: "route",
          reference_id: input.providerId.replace(/-/g, "").slice(0, 20),
          legal_business_name: input.legalName,
          business_type: "individual",
          contact_name: input.legalName,
          profile: { category: "services", subcategory: "repair_and_cleaning", addresses: { registered } },
        });
        ids.razorpay_account_id = acc.id;
        await persist({ razorpay_account_id: acc.id });
      }
      const acc = ids.razorpay_account_id!;
      const stakeholder = {
        name: input.legalName,
        email: input.email,
        addresses: { residential: { street: a.street.slice(0, 255), city: a.city, state: a.state, postal_code: a.postalCode, country: "IN" } },
        kyc: { pan: input.pan },
      };
      if (!ids.stakeholder_id) {
        const sth = await http<{ id: string }>("POST", `/v2/accounts/${acc}/stakeholders`, stakeholder);
        ids.stakeholder_id = sth.id;
        await persist({ stakeholder_id: sth.id });
      } else {
        await http("PATCH", `/v2/accounts/${acc}/stakeholders/${ids.stakeholder_id}`, stakeholder);
      }
      if (!ids.product_id) {
        const prd = await http<ProductConfig>("POST", `/v2/accounts/${acc}/products`, { product_name: "route", tnc_accepted: true });
        ids.product_id = prd.id;
        await persist({ product_id: prd.id });
      }
      const updated = await http<ProductConfig>("PATCH", `/v2/accounts/${acc}/products/${ids.product_id}`, {
        settlements: { account_number: input.accountNumber, ifsc_code: input.ifsc, beneficiary_name: input.legalName },
        tnc_accepted: true,
      });
      return { status: routeStatus(updated.activation_status), requirements: updated.requirements ?? [], syncId: acc };
    },
    async getStatus(existing) {
      if (!existing.razorpay_account_id || !existing.product_id) return null;
      const prd = await http<ProductConfig>("GET", `/v2/accounts/${existing.razorpay_account_id}/products/${existing.product_id}`);
      return { status: routeStatus(prd.activation_status), requirements: prd.requirements ?? [], syncId: existing.razorpay_account_id };
    },
    async release(t) {
      if (!t.accountId || !t.razorpayPaymentId) throw new GatewayError("route transfer needs account and source payment", 400, "missing destination");
      // A previous attempt may have succeeded even though we saw an error (e.g. timeout): find it by notes.transfer_id.
      if (t.attempts > 0) {
        const res = await http<{ items: { id: string; notes?: Record<string, string> | unknown[] }[] }>(
          "GET",
          `/v1/payments/${t.razorpayPaymentId}/transfers`,
        );
        const match = (res.items ?? []).find((i) => !Array.isArray(i.notes) && i.notes?.transfer_id === t.transferId);
        if (match) return { externalId: match.id, gatewayStatus: "existing" };
      }
      const res = await http<{ items: { id: string; status?: string }[] }>("POST", `/v1/payments/${t.razorpayPaymentId}/transfers`, {
        transfers: [
          {
            account: t.accountId,
            amount: t.amount,
            currency: "INR",
            notes: { booking_id: t.bookingId, payout_id: t.payoutId, transfer_id: t.transferId },
          },
        ],
      });
      const id = res.items?.[0]?.id;
      if (!id) throw new GatewayError("no transfer id in response", 502, "no transfer id");
      return { externalId: id, gatewayStatus: res.items[0].status ?? "created" };
    },
    async reverse(externalId, amount, reversalId) {
      if (reversalId) {
        const prior = await http<{ items: { id: string; notes?: Record<string, string> | unknown[] }[] }>(
          "GET",
          `/v1/transfers/${externalId}/reversals`,
        );
        const existing = (prior.items ?? []).find(
          (item) => !Array.isArray(item.notes) && item.notes?.reversal_id === reversalId,
        );
        if (existing) return existing.id;
      }
      const r = await http<{ id: string }>("POST", `/v1/transfers/${externalId}/reversals`, {
        amount,
        ...(reversalId ? { notes: { reversal_id: reversalId } } : {}),
      });
      return r.id;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// RazorpayX Payouts
// ---------------------------------------------------------------------------------------------------------------
interface Validation {
  id: string;
  status: "created" | "completed" | "failed";
  results?: { account_status?: string | null; registered_name?: string | null; details?: string | null; name_match_score?: number | string | null };
}

/** Maps a fund account validation to the shared status vocabulary. */
export function mapValidation(v: Validation, expectedName: string): { status: GatewayStatus; requirements: Requirement[]; score: number | null } {
  // Webhook payloads use "results"; the API reference also documents "validation_results".
  const results = v.results ?? (v as unknown as { validation_results?: Validation["results"] }).validation_results;
  v = { ...v, results };
  const raw = v.results?.name_match_score;
  const score = raw == null || raw === "" ? null : Number(raw);
  if (v.status === "created") return { status: "under_review", requirements: [], score };
  if (v.status === "failed") {
    return {
      status: "needs_clarification",
      requirements: [{ field_reference: "bank_account", reason_code: "validation_failed", description: "We could not verify this bank account. Check the account number and IFSC." }],
      score,
    };
  }
  if (v.results?.account_status !== "active") {
    return {
      status: "needs_clarification",
      requirements: [{
        field_reference: "bank_account.account_number",
        reason_code: "invalid_account",
        description: v.results?.details?.slice(0, 200) || "This bank account is not active. Use another account.",
      }],
      score,
    };
  }
  if (!namesMatch(expectedName, v.results?.registered_name, Number.isFinite(score as number) ? score : null)) {
    return {
      status: "needs_clarification",
      requirements: [{ field_reference: "bank_account.name", reason_code: "name_mismatch", description: "The bank account holder's name does not match the name on your PAN." }],
      score,
    };
  }
  return { status: "activated", requirements: [], score };
}

export function payoutsRail(http: Http, platformAccountNumber: string | null): PayoutRail {
  const requireAccount = () => {
    if (!platformAccountNumber) {
      throw new GatewayError("RAZORPAYX_ACCOUNT_NUMBER is not configured", 400, "RAZORPAYX_ACCOUNT_NUMBER is not configured");
    }
    return platformAccountNumber;
  };
  return {
    name: "payouts",
    async onboardBeneficiary(input, existing, persist) {
      const ids: BeneficiaryIds = { ...existing };
      if (!ids.contact_id) {
        // Contacts are de-duplicated by Razorpay when name/email/contact/type/reference_id all match.
        const c = await http<{ id: string }>("POST", "/v1/contacts", {
          name: input.legalName.slice(0, 50),
          email: input.email,
          contact: input.phone,
          type: "vendor",
          reference_id: input.providerId,
          notes: { provider_id: input.providerId },
        });
        ids.contact_id = c.id;
        await persist({ contact_id: c.id });
      }
      // Fund accounts are immutable and de-duplicated on (contact, name, ifsc, account number).
      const fa = await http<{ id: string }>("POST", "/v1/fund_accounts", {
        contact_id: ids.contact_id,
        account_type: "bank_account",
        bank_account: { name: input.legalName.slice(0, 120), ifsc: input.ifsc, account_number: input.accountNumber },
      });
      const changed = fa.id !== ids.fund_account_id;
      ids.fund_account_id = fa.id;
      if (changed) await persist({ fund_account_id: fa.id, validation_id: null });
      if (!changed && ids.validation_id) {
        const v = await http<Validation>("GET", `/v1/fund_accounts/validations/${ids.validation_id}`);
        const m = mapValidation(v, input.legalName);
        return { status: m.status, requirements: m.requirements, syncId: fa.id, nameMatchScore: m.score };
      }
      const v = await http<Validation>("POST", "/v1/fund_accounts/validations", {
        account_number: requireAccount(),
        fund_account: { id: fa.id },
        amount: 100,
        currency: "INR",
        notes: { provider_id: input.providerId },
      });
      await persist({ validation_id: v.id });
      const m = mapValidation(v, input.legalName);
      return { status: m.status, requirements: m.requirements, syncId: fa.id, nameMatchScore: m.score };
    },
    async getStatus(existing, persist) {
      if (!existing.fund_account_id) return null;
      if (!existing.validation_id) {
        // Validation needs only the fund account id, so a validation blocked earlier (e.g. RazorpayX not yet
        // activated) resumes without the provider re-entering bank details.
        const created = await http<Validation>("POST", "/v1/fund_accounts/validations", {
          account_number: requireAccount(),
          fund_account: { id: existing.fund_account_id },
          amount: 100,
          currency: "INR",
        });
        if (persist) await persist({ validation_id: created.id });
        const m = mapValidation(created, existing.beneficiary_name ?? "");
        return { status: m.status, requirements: m.requirements, syncId: existing.fund_account_id, nameMatchScore: m.score };
      }
      const v = await http<Validation>("GET", `/v1/fund_accounts/validations/${existing.validation_id}`);
      const m = mapValidation(v, existing.beneficiary_name ?? "");
      return { status: m.status, requirements: m.requirements, syncId: existing.fund_account_id, nameMatchScore: m.score };
    },
    async release(t) {
      if (!t.fundAccountId) throw new GatewayError("payout needs a fund account", 400, "missing fund account");
      // Same idempotency key on every automatic retry => Razorpay returns the original payout, never a second one.
      const p = await http<{ id: string; status: string; status_details?: { description?: string } }>(
        "POST",
        "/v1/payouts",
        {
          account_number: requireAccount(),
          fund_account_id: t.fundAccountId,
          amount: t.amount,
          currency: "INR",
          // IMPS up to ₹5 lakh, NEFT above.
          mode: t.amount <= 50_000_000 ? "IMPS" : "NEFT",
          purpose: "payout",
          queue_if_low_balance: true,
          reference_id: t.transferId,
          narration: "QuickServe payout",
          notes: { booking_id: t.bookingId, payout_id: t.payoutId, transfer_id: t.transferId },
        },
        { "X-Payout-Idempotency": t.idempotencyKey },
      );
      if (["failed", "reversed", "rejected", "cancelled"].includes(p.status)) {
        throw new GatewayError(`payout ${p.status}: ${p.status_details?.description ?? ""}`, 422, p.status_details?.description ?? p.status);
      }
      return { externalId: p.id, gatewayStatus: p.status };
    },
    reverse() {
      return Promise.reject(new GatewayError("RazorpayX payouts cannot be reversed; record a provider receivable", 400, "unsupported"));
    },
  };
}

export function railFor(name: RailName, http: Http, platformAccountNumber: string | null): PayoutRail {
  return name === "route" ? routeRail(http) : payoutsRail(http, platformAccountNumber);
}

// ---------------------------------------------------------------------------------------------------------------
// Webhooks (called from razorpay-webhook after signature verification)
// ---------------------------------------------------------------------------------------------------------------
export interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  from(table: string): {
    select(cols: string): { eq(col: string, v: string): { maybeSingle(): PromiseLike<{ data: Record<string, unknown> | null; error: unknown }> } };
  };
}

export interface RailWebhookEvent {
  event: string;
  account_id?: string;
  created_at?: number;
  payload?: Record<string, { entity?: Record<string, unknown>; data?: Record<string, unknown> } | undefined>;
}

export function isRailEvent(name: string): boolean {
  return name.startsWith("product.route.") || name.startsWith("fund_account.validation.") || name.startsWith("payout.");
}

/** Returns an HTTP status + body. 5xx => Razorpay retries the webhook. */
export async function handleRailWebhook(admin: RpcClient, ev: RailWebhookEvent): Promise<{ status: number; body: Record<string, unknown> }> {
  const at = new Date((ev.created_at ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();

  if (ev.event.startsWith("product.route.")) {
    const mp = ev.payload?.merchant_product;
    const entity = mp?.entity ?? {};
    const accountId = String(entity.merchant_id ?? ev.account_id ?? "");
    const status = String(entity.activation_status ?? ev.event.slice("product.route.".length));
    const requirements = (mp?.data as { requirements?: Requirement[] } | undefined)?.requirements ?? [];
    if (!accountId) return { status: 400, body: { error: "missing account" } };
    const { data, error } = await admin.rpc("sync_provider_payout_status", {
      p_account_id: accountId, p_status: status, p_requirements: requirements, p_event_at: at,
    });
    if (error) return { status: 500, body: { error: "processing failed" } };
    return { status: 200, body: { received: true, result: data } };
  }

  if (ev.event.startsWith("fund_account.validation.")) {
    const v = ev.payload?.["fund_account.validation"]?.entity as unknown as (Validation & { fund_account?: { id?: string } }) | undefined;
    const faId = v?.fund_account?.id;
    if (!v || !faId) return { status: 400, body: { error: "missing validation" } };
    const { data: row } = await admin.from("provider_payout_accounts").select("beneficiary_name, validation_id").eq("fund_account_id", faId).maybeSingle();
    if (!row) return { status: 200, body: { received: true, ignored: "unknown fund account" } };
    if (row.validation_id && row.validation_id !== v.id) return { status: 200, body: { received: true, ignored: "superseded validation" } };
    const m = mapValidation(v, String(row.beneficiary_name ?? ""));
    const { data, error } = await admin.rpc("sync_provider_payout_status", {
      p_account_id: faId, p_status: m.status, p_requirements: m.requirements, p_event_at: at,
    });
    if (error) return { status: 500, body: { error: "processing failed" } };
    return { status: 200, body: { received: true, result: data } };
  }

  if (ev.event.startsWith("payout.")) {
    const p = ev.payload?.payout?.entity as { id?: string; status?: string; utr?: string | null; status_details?: { description?: string } } | undefined;
    if (!p?.id) return { status: 400, body: { error: "missing payout" } };
    const { data, error } = await admin.rpc("record_payout_gateway_event", {
      p_external_id: p.id,
      p_status: p.status ?? ev.event.slice("payout.".length),
      p_utr: p.utr ?? null,
      p_reason: p.status_details?.description ?? null,
    });
    if (error) return { status: 500, body: { error: "processing failed" } };
    return { status: 200, body: { received: true, result: data } };
  }
  return { status: 200, body: { received: true, ignored: ev.event } };
}
