import { appendGatewayWebhookLog } from "./webhook-log.ts";

type Client = Parameters<typeof appendGatewayWebhookLog>[0];

function fakeClient({
  insertError = null,
  storedPayload,
  selectError = null,
}: {
  insertError?: { code?: string; message: string } | null;
  storedPayload?: unknown;
  selectError?: { code?: string; message: string } | null;
} = {}) {
  const calls: {
    inserts: Array<{ table: string; row: Record<string, unknown> }>;
    selects: Array<{ table: string; columns: string }>;
    filters: Array<{ column: string; value: string }>;
  } = { inserts: [], selects: [], filters: [] };
  const client = {
    from(table: string) {
      return {
        async insert(row: Record<string, unknown>) {
          calls.inserts.push({ table, row });
          return { error: insertError };
        },
        select(columns: string) {
          calls.selects.push({ table, columns });
          return {
            eq(column: string, value: string) {
              calls.filters.push({ column, value });
              return {
                async maybeSingle() {
                  return {
                    data: storedPayload === undefined ? null : { payload: storedPayload },
                    error: selectError,
                  };
                },
              };
            },
          };
        },
      };
    },
  } as unknown as Client;
  return { client, calls };
}

Deno.test("webhook log stores the event id, name, and payload", async () => {
  const { client, calls } = fakeClient();
  const event = { event: "order.paid", payload: { order: { id: "order_test" } } };
  const result = await appendGatewayWebhookLog(client, "evt_test", "order.paid", event);

  if (result.ok !== true) throw new Error(`expected a successful log insert; actual=${JSON.stringify({ result, calls })}`);
  if (result.duplicate) throw new Error(`expected a new log row; actual=${JSON.stringify({ result, calls })}`);
  if (calls.inserts.length !== 1 || calls.inserts[0].table !== "gateway_webhook_log"
    || calls.inserts[0].row.event_id !== "evt_test"
    || calls.inserts[0].row.event !== "order.paid"
    || JSON.stringify(calls.inserts[0].row.payload) !== JSON.stringify(event)) {
    throw new Error(`unexpected webhook log insert; actual=${JSON.stringify({ result, calls })}`);
  }
});

Deno.test("identical event-id replay is non-fatal after payload lookup", async () => {
  const incoming = {
    event: "order.paid",
    payload: { order: { id: "order_test" }, metadata: { alpha: 1, beta: 2 } },
  };
  const storedPayload = {
    metadata: { beta: 2, alpha: 1 },
    payload: { order: { id: "order_test" } },
    event: "order.paid",
  };
  const { client, calls } = fakeClient({
    insertError: { code: "23505", message: "duplicate event id" },
    storedPayload,
  });
  const result = await appendGatewayWebhookLog(client, "evt_replay", "order.paid", incoming);

  if (result.ok !== true || result.duplicate !== true
    || calls.inserts.length !== 1 || calls.selects.length !== 1
    || calls.filters[0]?.column !== "event_id" || calls.filters[0]?.value !== "evt_replay") {
    throw new Error(`expected identical replay to continue; actual=${JSON.stringify({ result, calls, incoming, storedPayload })}`);
  }
});

Deno.test("same event id with a different payload is rejected with conflict", async () => {
  const incoming = { event: "order.paid", payload: { order: { id: "order_incoming" } } };
  const storedPayload = { event: "order.paid", payload: { order: { id: "order_original" } } };
  const { client, calls } = fakeClient({
    insertError: { code: "23505", message: "duplicate event id" },
    storedPayload,
  });
  const result = await appendGatewayWebhookLog(client, "evt_conflict", "order.paid", incoming);

  if (result.ok !== false || result.status !== 409
    || calls.inserts.length !== 1 || calls.selects.length !== 1
    || JSON.stringify(incoming) === JSON.stringify(storedPayload)) {
    throw new Error(`expected conflicting payload to be rejected; actual=${JSON.stringify({ result, calls, incoming, storedPayload })}`);
  }
});

Deno.test("webhook log storage failures request a retry", async () => {
  const { client, calls } = fakeClient({ insertError: { code: "08006", message: "database unavailable" } });
  const result = await appendGatewayWebhookLog(client, null, "order.paid", { event: "order.paid" });

  if (result.ok !== false || result.status !== 500 || calls.inserts.length !== 1 || calls.selects.length !== 0) {
    throw new Error(`expected storage failure to be returned; actual=${JSON.stringify({ result, calls })}`);
  }
});
