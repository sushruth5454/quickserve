// WP F6; tests: daily reconciliation pagination, mismatch detection, and clean report behavior.

import { assertEquals } from "jsr:@std/assert@1";
import { collectGatewayRecords, compareGatewayAndLocal } from "./logic.ts";

Deno.test("daily reconciliation fetches every gateway page and reports exact mismatches", async () => {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url: `${url.pathname}${url.search}`, authorization: new Headers(init?.headers).get("Authorization") });
    const skip = Number(url.searchParams.get("skip"));
    let items: Record<string, unknown>[] = [];
    if (url.pathname === "/v1/payments") {
      items = skip === 0
        ? Array.from({ length: 100 }, (_, index) => ({ id: `pay_page_${index}`, amount: 1000, status: "captured" }))
        : [
          { id: "pay_gateway_only", amount: 2000, status: "captured" },
          { id: "pay_amount_mismatch", amount: 900, status: "captured" },
          { id: "pay_not_captured", amount: 500, status: "created" },
        ];
    } else if (url.pathname === "/v1/refunds") {
      items = [{ id: "rfnd_gateway_only", amount: 700, payment_id: "pay_refunded", status: "processed" }];
    } else if (url.pathname === "/v1/payouts") {
      items = [{ id: "pout_match", amount: 900, reference_id: "transfer_match", status: "processed" }];
    }
    return Response.json({ items });
  };

  const gateway = await collectGatewayRecords({
    from: 1_800_000_000,
    to: 1_800_086_400,
    keyId: "test_key",
    keySecret: "test_secret",
    fetcher,
  });
  const local = {
    payments: [
      ...Array.from({ length: 100 }, (_, index) => ({
        local_id: `payment_${index}`,
        gateway_id: `pay_page_${index}`,
        amount: 1000,
      })),
      { local_id: "payment_2", gateway_id: "pay_amount_mismatch", amount: 1100 },
      { local_id: "payment_3", gateway_id: "pay_local_only", amount: 300 },
    ],
    refunds: [
      { local_id: "refund_1", gateway_id: "rfnd_local_only", amount: 500 },
    ],
    payouts: [
      { local_id: "transfer_match", gateway_id: "pout_match", amount: 900 },
    ],
  };
  const issues = compareGatewayAndLocal("2026-11-18", gateway, local);

  assertEquals(
    issues.map(({ entity_type, issue, gateway_id, local_id, expected_amount, actual_amount }) => ({
      entity_type, issue, gateway_id, local_id, expected_amount, actual_amount,
    })),
    [
      {
        entity_type: "payment",
        issue: "missing_local",
        gateway_id: "pay_gateway_only",
        local_id: null,
        expected_amount: null,
        actual_amount: 2000,
      },
      {
        entity_type: "payment",
        issue: "amount_mismatch",
        gateway_id: "pay_amount_mismatch",
        local_id: "payment_2",
        expected_amount: 1100,
        actual_amount: 900,
      },
      {
        entity_type: "payment",
        issue: "missing_gateway",
        gateway_id: "pay_local_only",
        local_id: "payment_3",
        expected_amount: 300,
        actual_amount: null,
      },
      {
        entity_type: "refund",
        issue: "missing_local",
        gateway_id: "rfnd_gateway_only",
        local_id: null,
        expected_amount: null,
        actual_amount: 700,
      },
      {
        entity_type: "refund",
        issue: "missing_gateway",
        gateway_id: "rfnd_local_only",
        local_id: "refund_1",
        expected_amount: 500,
        actual_amount: null,
      },
    ],
    `daily mismatch details must match local/gateway ids and paise; actual=${JSON.stringify({ gateway, issues })}`,
  );
  assertEquals(
    calls.map(({ url }) => url),
    [
      "/v1/payments?from=1800000000&to=1800086400&count=100&skip=0",
      "/v1/payments?from=1800000000&to=1800086400&count=100&skip=100",
      "/v1/refunds?from=1800000000&to=1800086400&count=100&skip=0",
      "/v1/payouts?from=1800000000&to=1800086400&count=100&skip=0",
    ],
    `gateway collections must be paginated with the requested day bounds; actual=${JSON.stringify(calls)}`,
  );
  assertEquals(
    calls.every(({ authorization }) => authorization === `Basic ${btoa("test_key:test_secret")}`),
    true,
    `gateway fetches must carry server-side basic auth; actual=${JSON.stringify(calls)}`,
  );
});

Deno.test("daily reconciliation returns no issues when gateway and database agree", () => {
  const snapshot = {
    payments: [{ id: "pay_clean", amount: 193760, status: "captured" }],
    refunds: [{ id: "rfnd_clean", amount: 500, status: "processed" }],
    payouts: [{ id: "pout_clean", amount: 900, reference_id: "transfer_clean", status: "processed" }],
  };
  const local = {
    payments: [{ local_id: "payment_clean", gateway_id: "pay_clean", amount: 193760 }],
    refunds: [{ local_id: "refund_clean", gateway_id: "rfnd_clean", amount: 500 }],
    payouts: [{ local_id: "transfer_clean", gateway_id: "pout_clean", amount: 900 }],
  };
  assertEquals(
    compareGatewayAndLocal("2026-11-18", snapshot, local),
    [],
    `clean gateway rows must produce an empty daily mismatch report; actual=${JSON.stringify({ snapshot, local })}`,
  );
});
