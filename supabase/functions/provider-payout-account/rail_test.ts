// Mocked-gateway tests for both payout rails, the webhook mapping and the payout form validation.
// Run (CI only): deno test supabase/functions/provider-payout-account
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  GatewayError,
  handleRailWebhook,
  isGatewayUnavailable,
  mapValidation,
  namesMatch,
  payoutsRail,
  routeRail,
  type BeneficiaryIds,
  type BeneficiaryInput,
  type Http,
  type RpcClient,
} from "../_shared/payout-rail.ts";
import {
  canManagePayoutAccount,
  canSubmitBusinessPayoutAccount,
  canSubmitPayoutAccount,
  businessPayoutFeatureEnabled,
  friendlyGatewayError,
  maskAccount,
  parseSubmit,
} from "./logic.ts";

interface Call {
  method: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}

function mockHttp(responder: (c: Call) => unknown): { http: Http; calls: Call[] } {
  const calls: Call[] = [];
  const http: Http = <T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown, headers?: Record<string, string>) => {
    const c = { method, path, body, headers };
    calls.push(c);
    try {
      return Promise.resolve(responder(c) as T);
    } catch (e) {
      return Promise.reject(e);
    }
  };
  return { http, calls };
}

const input: BeneficiaryInput = {
  providerId: "0b9a7c1e-1111-4222-8333-444455556666",
  legalName: "Ravi Kumar",
  pan: "ABCPK1234F",
  email: "ravi@example.com",
  phone: "9000000101",
  accountNumber: "123456789012",
  ifsc: "HDFC0001234",
  address: { street: "12 MG Road, Benz Circle", city: "Vijayawada", state: "Andhra Pradesh", postalCode: "520010" },
};

// ---------------------------------------------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------------------------------------------
Deno.test("route: creates account, stakeholder, product, then sends bank details; persists every id", async () => {
  const { http, calls } = mockHttp((c) => {
    if (c.method === "POST" && c.path === "/v2/accounts") return { id: "acc_1", status: "created" };
    if (c.method === "POST" && c.path === "/v2/accounts/acc_1/stakeholders") return { id: "sth_1" };
    if (c.method === "POST" && c.path === "/v2/accounts/acc_1/products") return { id: "acc_prd_1", activation_status: "needs_clarification" };
    if (c.method === "PATCH" && c.path === "/v2/accounts/acc_1/products/acc_prd_1") return { id: "acc_prd_1", activation_status: "activated", requirements: [] };
    throw new Error("unexpected " + c.method + " " + c.path);
  });
  const persisted: BeneficiaryIds[] = [];
  const r = await routeRail(http).onboardBeneficiary(input, {}, async (ids) => void persisted.push(ids));
  assertEquals(r.status, "activated");
  assertEquals(r.syncId, "acc_1");
  assertEquals(persisted, [{ razorpay_account_id: "acc_1" }, { stakeholder_id: "sth_1" }, { product_id: "acc_prd_1" }]);
  const acc = calls[0].body as Record<string, unknown>;
  assertEquals(acc.business_type, "individual");
  assertEquals(acc.type, "route");
  assertEquals((acc.reference_id as string).length <= 20, true);
  assertEquals((calls[1].body as { kyc: { pan: string } }).kyc.pan, "ABCPK1234F");
  assertEquals((calls[2].body as Record<string, unknown>).product_name, "route");
  assertEquals((calls[3].body as { settlements: Record<string, string> }).settlements, {
    account_number: "123456789012",
    ifsc_code: "HDFC0001234",
    beneficiary_name: "Ravi Kumar",
  });
});

Deno.test("route: re-submission is idempotent (updates stakeholder + product, never creates a second account)", async () => {
  const { http, calls } = mockHttp((c) => {
    if (c.method === "PATCH" && c.path === "/v2/accounts/acc_1/stakeholders/sth_1") return { id: "sth_1" };
    if (c.method === "PATCH" && c.path === "/v2/accounts/acc_1/products/acc_prd_1") {
      return {
        id: "acc_prd_1",
        activation_status: "needs_clarification",
        requirements: [{ field_reference: "settlements.ifsc_code", reason_code: "needs_clarification", description: "Max retry exceeded" }],
      };
    }
    throw new Error("unexpected " + c.method + " " + c.path);
  });
  const r = await routeRail(http).onboardBeneficiary(
    input,
    { razorpay_account_id: "acc_1", stakeholder_id: "sth_1", product_id: "acc_prd_1" },
    () => Promise.resolve(),
  );
  assertEquals(r.status, "needs_clarification");
  assertEquals(r.requirements[0].field_reference, "settlements.ifsc_code");
  assertEquals(calls.filter((c) => c.method === "POST").length, 0);
});

Deno.test("route: 'Route feature not enabled' is classified as gateway unavailable", async () => {
  const { http } = mockHttp(() => {
    throw new GatewayError("x", 400, "Route feature not enabled for the merchant");
  });
  const e = await assertRejects(() => routeRail(http).onboardBeneficiary(input, {}, () => Promise.resolve()));
  assert(isGatewayUnavailable(e));
});

Deno.test("route: release retries look up an earlier transfer by notes.transfer_id before creating one", async () => {
  const { http, calls } = mockHttp((c) => {
    if (c.method === "GET") return { items: [{ id: "trf_old", notes: { transfer_id: "t1" } }] };
    throw new Error("must not POST");
  });
  const r = await routeRail(http).release({
    transferId: "t1", payoutId: "p1", bookingId: "b1", amount: 19900, attempts: 1, idempotencyKey: "t1:0",
    razorpayPaymentId: "pay_1", accountId: "acc_1", fundAccountId: null,
  });
  assertEquals(r.externalId, "trf_old");
  assertEquals(calls.length, 1);
});

Deno.test("route: a failed prior transfer is not reused for a retry", async () => {
  const { http, calls } = mockHttp((c) => {
    if (c.method === "GET") {
      return { items: [{ id: "trf_failed", notes: { transfer_id: "t1" }, status: "failed" }] };
    }
    return { items: [{ id: "trf_retry", status: "created" }] };
  });
  const r = await routeRail(http).release({
    transferId: "t1", payoutId: "p1", bookingId: "b1", amount: 19900, attempts: 1, idempotencyKey: "t1:1",
    razorpayPaymentId: "pay_1", accountId: "acc_1", fundAccountId: null,
  });
  assertEquals(
    { externalId: r.externalId, methods: calls.map((call) => call.method) },
    { externalId: "trf_retry", methods: ["GET", "POST"] },
    `failed prior transfer must not be completed again; actual=${JSON.stringify({ result: r, calls })}`,
  );
});

// ---------------------------------------------------------------------------------------------------------------
// RazorpayX Payouts
// ---------------------------------------------------------------------------------------------------------------
Deno.test("payouts: contact + fund account + penny-drop validation; name match activates", async () => {
  const { http, calls } = mockHttp((c) => {
    if (c.path === "/v1/contacts") return { id: "cont_1" };
    if (c.path === "/v1/fund_accounts") return { id: "fa_1" };
    if (c.path === "/v1/fund_accounts/validations") {
      return { id: "fav_1", status: "completed", results: { account_status: "active", registered_name: "RAVI KUMAR", name_match_score: 100 } };
    }
    throw new Error("unexpected " + c.path);
  });
  const persisted: BeneficiaryIds[] = [];
  const r = await payoutsRail(http, "7878780080316316").onboardBeneficiary(input, {}, async (ids) => void persisted.push(ids));
  assertEquals(r.status, "activated");
  assertEquals(r.syncId, "fa_1");
  assertEquals(persisted, [{ contact_id: "cont_1" }, { fund_account_id: "fa_1", validation_id: null }, { validation_id: "fav_1" }]);
  assertEquals((calls[0].body as Record<string, string>).type, "vendor");
  assertEquals((calls[2].body as { account_number: string }).account_number, "7878780080316316");
  // PAN is never sent on this rail.
  assert(!JSON.stringify(calls.map((c) => c.body)).includes("ABCPK1234F"));
});

Deno.test("payouts: same bank details re-submitted reuse the fund account and existing validation", async () => {
  const { http, calls } = mockHttp((c) => {
    if (c.path === "/v1/fund_accounts") return { id: "fa_1" };
    if (c.method === "GET" && c.path === "/v1/fund_accounts/validations/fav_1") {
      return { id: "fav_1", status: "created", results: { account_status: null, registered_name: null } };
    }
    throw new Error("unexpected " + c.method + " " + c.path);
  });
  const r = await payoutsRail(http, "7878").onboardBeneficiary(input, { contact_id: "cont_1", fund_account_id: "fa_1", validation_id: "fav_1" }, () => Promise.resolve());
  assertEquals(r.status, "under_review");
  assertEquals(calls.filter((c) => c.path === "/v1/contacts").length, 0);
  assertEquals(calls.filter((c) => c.method === "POST" && c.path === "/v1/fund_accounts/validations").length, 0);
});

Deno.test("payouts: missing RazorpayX account number or 'Access to requested resource not available' => unavailable", async () => {
  const { http } = mockHttp((c) => {
    if (c.path === "/v1/contacts") return { id: "cont_1" };
    if (c.path === "/v1/fund_accounts") return { id: "fa_1" };
    throw new Error("unexpected");
  });
  const e1 = await assertRejects(() => payoutsRail(http, null).onboardBeneficiary(input, {}, () => Promise.resolve()));
  assert(isGatewayUnavailable(e1));
  assert(isGatewayUnavailable(new GatewayError("x", 400, "Access to requested resource not available")));
  assert(isGatewayUnavailable(new GatewayError("x", 401, "The api key provided is invalid")));
  assert(!isGatewayUnavailable(new GatewayError("x", 400, "Invalid IFSC Code")));
  assert(!isGatewayUnavailable(new Error("plain")));
});

Deno.test("payouts: blocked validation resumes from the stored fund account without bank details", async () => {
  const { http, calls } = mockHttp((c) => {
    if (c.method === "POST" && c.path === "/v1/fund_accounts/validations") return { id: "fav_9", status: "created" };
    throw new Error("unexpected");
  });
  const persisted: BeneficiaryIds[] = [];
  const r = await payoutsRail(http, "7878").getStatus({ fund_account_id: "fa_1", beneficiary_name: "Ravi Kumar" }, async (ids) => void persisted.push(ids));
  assertEquals(r?.status, "under_review");
  assertEquals(persisted, [{ validation_id: "fav_9" }]);
  assertEquals((calls[0].body as { fund_account: { id: string } }).fund_account.id, "fa_1");
});

Deno.test("payouts: release sends X-Payout-Idempotency and IMPS/NEFT by amount; failed payouts throw", async () => {
  const { http, calls } = mockHttp((c) => {
    const amount = (c.body as { amount: number }).amount;
    return amount === 666 ? { id: "pout_bad", status: "failed", status_details: { description: "Beneficiary bank down" } } : { id: "pout_1", status: "processing" };
  });
  const rail = payoutsRail(http, "7878780080316316");
  const base = { transferId: "t1", payoutId: "p1", bookingId: "b1", attempts: 0, idempotencyKey: "t1:0", razorpayPaymentId: "pay_1", accountId: null, fundAccountId: "fa_1" };
  const r = await rail.release({ ...base, amount: 19376 });
  assertEquals(r.externalId, "pout_1");
  assertEquals(calls[0].headers?.["X-Payout-Idempotency"], "t1:0");
  assertEquals((calls[0].body as { mode: string }).mode, "IMPS");
  await rail.release({ ...base, amount: 60_000_000 });
  assertEquals((calls[1].body as { mode: string }).mode, "NEFT");
  await assertRejects(() => rail.release({ ...base, amount: 666 }));
  await assertRejects(() => rail.reverse("pout_1", 100));
});

Deno.test("payouts: validation mapping (invalid account, name mismatch, failed)", () => {
  assertEquals(mapValidation({ id: "v", status: "completed", results: { account_status: "invalid", details: "Account closed" } }, "Ravi Kumar").status, "needs_clarification");
  const mm = mapValidation({ id: "v", status: "completed", results: { account_status: "active", registered_name: "SURESH BABU", name_match_score: 20 } }, "Ravi Kumar");
  assertEquals(mm.status, "needs_clarification");
  assertEquals(mm.requirements[0].reason_code, "name_mismatch");
  assertEquals(mapValidation({ id: "v", status: "failed" }, "Ravi Kumar").requirements[0].reason_code, "validation_failed");
});

Deno.test("namesMatch: honorifics, initials, order, score threshold", () => {
  assert(namesMatch("Ravi Kumar", "MR RAVI KUMAR"));
  assert(namesMatch("Ravi Kumar", "KUMAR RAVI"));
  assert(namesMatch("R Kumar", "RAVI KUMAR"));
  assert(namesMatch("Ravi Kumar Nizampuram", "RAVI KUMAR"));
  assert(!namesMatch("Ravi Kumar", "SURESH BABU"));
  assert(!namesMatch("Ravi Kumar", null));
  assert(namesMatch("Ravi Kumar", "R.K. ENTERPRISES", 82));
});

// ---------------------------------------------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------------------------------------------
function mockAdmin(row: Record<string, unknown> | null = {
  provider_id: "provider_1",
  razorpay_account_id: "acc_1",
  fund_account_id: "fa_1",
  beneficiary_name: "Ravi Kumar",
  validation_id: "fav_1",
}) {
  const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
  const admin: RpcClient = {
    rpc(fn, args) {
      rpcs.push({ fn, args });
      return Promise.resolve({ data: { ok: true }, error: null });
    },
    from(table) {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({
              data: table === "providers" ? row?.provider_id ? { id: row.provider_id } : null : row,
              error: null,
            }),
          }),
        }),
      };
    },
  };
  return { admin, rpcs };
}

Deno.test("webhook: product.route.activated / needs_clarification / rejected call sync_provider_payout_status", async () => {
  for (const [event, status] of [
    ["product.route.activated", "activated"],
    ["product.route.needs_clarification", "needs_clarification"],
    ["product.route.rejected", "rejected"],
    ["product.route.under_review", "under_review"],
  ]) {
    const { admin, rpcs } = mockAdmin();
    const reqs = status === "needs_clarification" ? [{ field_reference: "settlements.account_number", reason_code: "needs_clarification", description: "Max retry" }] : [];
    const r = await handleRailWebhook(admin, {
      event,
      account_id: "acc_1",
      created_at: 1747047578,
      payload: { merchant_product: { entity: { id: "acc_prd_1", merchant_id: "acc_1", activation_status: status }, data: { requirements: reqs } } },
    });
    assertEquals(r.status, 200);
    assertEquals(rpcs[0].fn, "sync_provider_payout_status");
    assertEquals(rpcs[0].args.p_account_id, "acc_1");
    assertEquals(rpcs[0].args.p_status, status);
    assertEquals(rpcs[0].args.p_requirements, reqs);
    assertEquals(rpcs[0].args.p_event_at, new Date(1747047578 * 1000).toISOString());
  }
});

Deno.test("webhook: fund_account.validation.completed maps name match; superseded validations are ignored", async () => {
  const { admin, rpcs } = mockAdmin();
  const entity = { id: "fav_1", status: "completed", fund_account: { id: "fa_1" }, results: { account_status: "active", registered_name: "RAVI KUMAR", name_match_score: 100 } };
  const r = await handleRailWebhook(admin, { event: "fund_account.validation.completed", payload: { "fund_account.validation": { entity } } });
  assertEquals(r.status, 200);
  assertEquals(rpcs[0].args.p_account_id, "fa_1");
  assertEquals(rpcs[0].args.p_status, "activated");

  const other = mockAdmin({ beneficiary_name: "Ravi Kumar", validation_id: "fav_NEW" });
  const r2 = await handleRailWebhook(other.admin, { event: "fund_account.validation.completed", payload: { "fund_account.validation": { entity } } });
  assertEquals(r2.body.ignored, "superseded validation");
  assertEquals(other.rpcs.length, 0);
});

Deno.test("webhook: payout.processed / payout.reversed call record_payout_gateway_event", async () => {
  for (const status of ["processed", "reversed", "failed"]) {
    const { admin, rpcs } = mockAdmin();
    await handleRailWebhook(admin, {
      event: `payout.${status}`,
      payload: { payout: { entity: { id: "pout_1", status, utr: status === "processed" ? "UTR123" : null, status_details: { description: "x" } } } },
    });
    assertEquals(rpcs[0].fn, "record_payout_gateway_event");
    assertEquals(rpcs[0].args.p_external_id, "pout_1");
    assertEquals(rpcs[0].args.p_status, status);
  }
});

Deno.test("webhook: rpc failure returns 500 so Razorpay retries", async () => {
  const admin: RpcClient = {
    rpc: () => Promise.resolve({ data: null, error: { message: "boom" } }),
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    }),
  };
  const r = await handleRailWebhook(admin, {
    event: "product.route.activated",
    account_id: "acc_1",
    payload: { merchant_product: { entity: { merchant_id: "acc_1", activation_status: "activated" } } },
  });
  assertEquals(r.status, 500);
});

Deno.test("webhook: verified venue owner payout status updates the profile payout account", async () => {
  const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
  const admin: RpcClient = {
    rpc(fn, args) {
      rpcs.push({ fn, args });
      return Promise.resolve({ data: { ok: true }, error: null });
    },
    from(table) {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: table === "provider_payout_accounts" ? { provider_id: "venue-owner" } : null,
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
  };
  const r = await handleRailWebhook(admin, {
    event: "product.route.activated",
    account_id: "acc_venue_owner",
    created_at: 1747047578,
    payload: { merchant_product: { entity: { merchant_id: "acc_venue_owner", activation_status: "activated" } } },
  });
  assertEquals(r.status, 200);
  assertEquals(rpcs, [{
    fn: "sync_venue_payout_status",
    args: {
      p_account_id: "acc_venue_owner",
      p_status: "activated",
      p_requirements: [],
      p_event_at: new Date(1747047578 * 1000).toISOString(),
    },
  }]);
});

Deno.test("webhook: venue-owner payout status write failure returns 500 for retry", async () => {
  const admin: RpcClient = {
    rpc: (fn) => Promise.resolve({
      data: null,
      error: fn === "sync_venue_payout_status" ? { message: "write failed" } : null,
    }),
    from(table) {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: table === "provider_payout_accounts" ? { provider_id: "venue-owner" } : null,
              error: null,
            }),
          }),
        }),
      };
    },
  };
  const r = await handleRailWebhook(admin, {
    event: "product.route.activated",
    account_id: "acc_venue_owner",
    payload: { merchant_product: { entity: { merchant_id: "acc_venue_owner", activation_status: "activated" } } },
  });
  assertEquals(r.status, 500);
});

// ---------------------------------------------------------------------------------------------------------------
// Form validation
// ---------------------------------------------------------------------------------------------------------------
Deno.test("payout account access accepts providers and verified venue owners, not other users or staff", () => {
  assert(canManagePayoutAccount(true, false));
  assert(canManagePayoutAccount(false, true));
  assert(!canManagePayoutAccount(false, false));
});

Deno.test("venue-owner payout submit requires both sports flags while provider enrollment remains unchanged", () => {
  assert(canSubmitPayoutAccount(true, true, { sports: false, sports_online_payments: false }));
  assert(canSubmitPayoutAccount(false, true, { sports: true, sports_online_payments: true }));
  assert(!canSubmitPayoutAccount(false, true, { sports: false, sports_online_payments: true }));
  assert(!canSubmitPayoutAccount(false, true, { sports: true, sports_online_payments: false }));
  assert(!canSubmitPayoutAccount(false, false, { sports: true, sports_online_payments: true }));
});

Deno.test("business payout identity stays unavailable until mapping approval and respects venue parent switches", () => {
  const providerFlags = { business_payout_identity: true };
  assert(businessPayoutFeatureEnabled(true, false, providerFlags));
  assert(!canSubmitBusinessPayoutAccount(true, false, providerFlags));
  assert(canSubmitBusinessPayoutAccount(true, false, providerFlags, true));
  assert(!businessPayoutFeatureEnabled(true, false, { business_payout_identity: false }));
  assert(!canSubmitBusinessPayoutAccount(true, false, { business_payout_identity: false }, true));
  const venueFlags = {
    business_payout_identity: true,
    sports: true,
    sports_online_payments: true,
  };
  assert(businessPayoutFeatureEnabled(false, true, venueFlags));
  assert(!canSubmitBusinessPayoutAccount(false, true, venueFlags));
  assert(canSubmitBusinessPayoutAccount(false, true, venueFlags, true));
  assert(!canSubmitBusinessPayoutAccount(false, true, {
    business_payout_identity: true,
    sports: false,
    sports_online_payments: true,
  }, true));
  assert(!canSubmitBusinessPayoutAccount(false, false, {
    business_payout_identity: true,
    sports: true,
    sports_online_payments: true,
  }, true));
});

Deno.test("parseSubmit: validates PAN (individual), IFSC, account confirmation, email; address only on route", () => {
  const ok = parseSubmit(
    { legal_name: " Ravi  Kumar ", pan: "abcpk1234f", email: "Ravi@Example.com", account_number: "1234 5678 9012", confirm_account_number: "123456789012", ifsc: "hdfc0001234" },
    { providerId: "p", phone: "+919000000101", rail: "payouts" },
  );
  assert(ok.ok);
  if (ok.ok) {
    assertEquals(ok.input.legalName, "Ravi Kumar");
    assertEquals(ok.input.pan, "ABCPK1234F");
    assertEquals(ok.input.phone, "9000000101");
    assertEquals(ok.input.address, undefined);
  }
  const bad = parseSubmit(
    { legal_name: "Ra", pan: "ABCDE1234F", email: "x", account_number: "12345", confirm_account_number: "1", ifsc: "HDFC1234567" },
    { providerId: "p", phone: "9000000101", rail: "route" },
  );
  assert(!bad.ok);
  if (!bad.ok) {
    assertEquals(Object.keys(bad.errors).sort(), ["account_number", "address", "email", "ifsc", "legal_name", "pan"]);
  }
  const mismatch = parseSubmit(
    { legal_name: "Ravi Kumar", pan: "ABCPK1234F", email: "r@x.in", account_number: "123456789012", confirm_account_number: "123456789013", ifsc: "HDFC0001234" },
    { providerId: "p", phone: "9000000101", rail: "payouts" },
  );
  assert(!mismatch.ok && mismatch.errors.confirm_account_number !== undefined);
  assertEquals(maskAccount("123456789012"), "9012");
  assert(friendlyGatewayError("settlements.ifsc_code", "Invalid IFSC Code").includes("IFSC"));
  assert(!friendlyGatewayError(null, "Invalid PAN ABCPK1234F").includes("ABCPK1234F"));
});

Deno.test("parseSubmit: business PAN requires business type and matching optional GSTIN", () => {
  const business = parseSubmit(
    {
      account_type: "business",
      legal_name: "Acme Services Pvt Ltd",
      pan: "aaacc1234c",
      gstin: "29aaacc1234c1z5",
      email: "billing@example.in",
      account_number: "123456789012",
      confirm_account_number: "123456789012",
      ifsc: "hdfc0001234",
    },
    { providerId: "p", phone: "+919000000101", rail: "payouts" },
  );
  assert(business.ok);
  if (business.ok) {
    assertEquals(business.input.accountType, "business");
    assertEquals(business.input.pan, "AAACC1234C");
    assertEquals(business.input.gstin, "29AAACC1234C1Z5");
  }

  const individual = parseSubmit(
    {
      account_type: "individual",
      legal_name: "Acme Services Pvt Ltd",
      pan: "AAACC1234C",
      email: "billing@example.in",
      account_number: "123456789012",
      confirm_account_number: "123456789012",
      ifsc: "HDFC0001234",
    },
    { providerId: "p", phone: "+919000000101", rail: "payouts" },
  );
  assert(!individual.ok && individual.errors.pan !== undefined);

  const mismatchedGstin = parseSubmit(
    {
      account_type: "business",
      legal_name: "Acme Services Pvt Ltd",
      pan: "AAACC1234C",
      gstin: "29ABBCD1234E1Z5",
      email: "billing@example.in",
      account_number: "123456789012",
      confirm_account_number: "123456789012",
      ifsc: "HDFC0001234",
    },
    { providerId: "p", phone: "+919000000101", rail: "payouts" },
  );
  assert(!mismatchedGstin.ok && mismatchedGstin.errors.gstin !== undefined);
});
