// WP F6; owns: daily gateway reconciliation logic; sources: WS6-T16.

const API_BASE = "https://api.razorpay.com";
const PAGE_SIZE = 100;
const MAX_PAGES = 10_000;

export interface GatewayRecord {
  id: string;
  amount: number;
  status?: string;
  reference_id?: string;
  payment_id?: string;
}

export interface GatewaySnapshot {
  payments: GatewayRecord[];
  refunds: GatewayRecord[];
  payouts: GatewayRecord[];
}

export interface LocalRecord {
  local_id: string;
  gateway_id: string | null;
  amount: number;
}

export type LocalGatewayKind = "payment" | "refund" | "payout";

interface LocalGatewayRow {
  id: string;
  amount: number;
  recovered_amount?: number | null;
  razorpay_payment_id?: string | null;
  razorpay_refund_id?: string | null;
  razorpay_transfer_id?: string | null;
}

export interface LocalSnapshot {
  payments: LocalRecord[];
  refunds: LocalRecord[];
  payouts: LocalRecord[];
}

export type ReconciliationIssueCode = "missing_local" | "missing_gateway" | "amount_mismatch";

export interface ReconciliationIssue {
  run_date: string;
  issue_key: string;
  entity_type: "payment" | "refund" | "payout";
  issue: ReconciliationIssueCode;
  issue_code: ReconciliationIssueCode;
  local_id: string | null;
  gateway_id: string | null;
  expected_amount: number | null;
  actual_amount: number | null;
  details: Record<string, unknown>;
}

export function localGatewayRecord(
  kind: LocalGatewayKind,
  row: LocalGatewayRow,
): LocalRecord | null {
  const gatewayId = kind === "payment"
    ? row.razorpay_payment_id
    : kind === "refund"
    ? row.razorpay_refund_id
    : row.razorpay_transfer_id;
  const syntheticPrefix = kind === "payment"
    ? "pay_demo_"
    : kind === "refund"
    ? "rfnd_demo_"
    : "netted_";
  if (gatewayId?.startsWith(syntheticPrefix)) return null;

  return {
    local_id: row.id,
    gateway_id: gatewayId ?? null,
    amount: kind === "payout" ? row.amount - (row.recovered_amount ?? 0) : row.amount,
  };
}

async function collectCollection(
  collection: "payments" | "refunds" | "payouts",
  from: number,
  to: number,
  keyId: string,
  keySecret: string,
  fetcher: typeof fetch,
): Promise<GatewayRecord[]> {
  const rows: GatewayRecord[] = [];
  for (let skip = 0, page = 0; page < MAX_PAGES; skip += PAGE_SIZE, page++) {
    const url = new URL(`${API_BASE}/v1/${collection}`);
    url.searchParams.set("from", String(from));
    url.searchParams.set("to", String(to));
    url.searchParams.set("count", String(PAGE_SIZE));
    url.searchParams.set("skip", String(skip));
    const response = await fetcher(url, {
      method: "GET",
      headers: {
        Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Razorpay ${collection} reconciliation failed (${response.status}): ${text.slice(0, 300)}`);
    }

    let items: unknown;
    try {
      items = (JSON.parse(text) as { items?: unknown }).items;
    } catch (error) {
      throw new Error(`Razorpay ${collection} returned invalid JSON: ${error instanceof Error ? error.message : error}`);
    }
    if (!Array.isArray(items)) throw new Error(`Razorpay ${collection} response did not contain an items array`);
    const records = items as GatewayRecord[];
    rows.push(...(collection === "payments"
      ? records.filter((row) => row.status === "captured")
      : records));
    if (items.length < PAGE_SIZE) return rows;
  }
  throw new Error(`Razorpay ${collection} pagination exceeded ${MAX_PAGES} pages`);
}

export async function collectGatewayRecords(input: {
  from: number;
  to: number;
  keyId: string;
  keySecret: string;
  fetcher?: typeof fetch;
}): Promise<GatewaySnapshot> {
  const fetcher = input.fetcher ?? fetch;
  const payments = await collectCollection("payments", input.from, input.to, input.keyId, input.keySecret, fetcher);
  const refunds = await collectCollection("refunds", input.from, input.to, input.keyId, input.keySecret, fetcher);
  const payouts = await collectCollection("payouts", input.from, input.to, input.keyId, input.keySecret, fetcher);
  return { payments, refunds, payouts };
}

function issue(
  runDate: string,
  entityType: ReconciliationIssue["entity_type"],
  issueCode: ReconciliationIssueCode,
  localId: string | null,
  gatewayId: string | null,
  expectedAmount: number | null,
  actualAmount: number | null,
  details: Record<string, unknown>,
): ReconciliationIssue {
  return {
    run_date: runDate,
    issue_key: [runDate, entityType, issueCode, gatewayId ?? "", localId ?? ""].join(":"),
    entity_type: entityType,
    issue: issueCode,
    issue_code: issueCode,
    local_id: localId,
    gateway_id: gatewayId,
    expected_amount: expectedAmount,
    actual_amount: actualAmount,
    details,
  };
}

export function compareGatewayAndLocal(
  runDate: string,
  gateway: GatewaySnapshot,
  local: LocalSnapshot,
): ReconciliationIssue[] {
  const issues: ReconciliationIssue[] = [];
  const entities: Array<{
    type: ReconciliationIssue["entity_type"];
    gateway: GatewayRecord[];
    local: LocalRecord[];
  }> = [
    { type: "payment", gateway: gateway.payments, local: local.payments },
    { type: "refund", gateway: gateway.refunds, local: local.refunds },
    { type: "payout", gateway: gateway.payouts, local: local.payouts },
  ];

  for (const entity of entities) {
    const matchedLocalIds = new Set<string>();
    for (const remote of entity.gateway) {
      const localRow = entity.local.find((candidate) =>
        !matchedLocalIds.has(candidate.local_id)
        && (candidate.gateway_id === remote.id
          || (entity.type === "payout" && remote.reference_id === candidate.local_id))
      );
      if (!localRow) {
        issues.push(issue(
          runDate,
          entity.type,
          "missing_local",
          null,
          remote.id,
          null,
          remote.amount,
          { gateway_status: remote.status ?? null, reference_id: remote.reference_id ?? null },
        ));
        continue;
      }

      matchedLocalIds.add(localRow.local_id);
      if (localRow.amount !== remote.amount) {
        issues.push(issue(
          runDate,
          entity.type,
          "amount_mismatch",
          localRow.local_id,
          remote.id,
          localRow.amount,
          remote.amount,
          { gateway_status: remote.status ?? null, reference_id: remote.reference_id ?? null },
        ));
      }
    }

    for (const localRow of entity.local) {
      if (matchedLocalIds.has(localRow.local_id)) continue;
      issues.push(issue(
        runDate,
        entity.type,
        "missing_gateway",
        localRow.local_id,
        localRow.gateway_id,
        localRow.amount,
        null,
        {},
      ));
    }
  }
  return issues;
}