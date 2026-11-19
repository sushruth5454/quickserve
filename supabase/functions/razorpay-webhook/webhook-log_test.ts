import { appendGatewayWebhookLog } from "./webhook-log.ts";

type Client = Parameters<typeof appendGatewayWebhookLog>[0];

function fakeClient(error: { code?: string; message: string } | null) {
  const calls: Array<{ table: string; row: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      return {
        async insert(row: Record<string, unknown>) {
          calls.push({ table, row });
          return { error };
        },
      };
    },
  } as unknown as Client;
  return { client, calls };
}

Deno.test("webhook log stores the event id, name, and payload", async () => {
  const { client, calls } = fakeClient(null);
  const event = { event: "order.paid", payload: { order: { id: "order_test" } } };
  const result = await appendGatewayWebhookLog(client, "evt_test", "order.paid", event);

  if (result.ok !== true) throw new Error(`expected a successful log insert; actual=${JSON.stringify({ result, calls })}`);
  if (result.duplicate) throw new Error(`expected a new log row; actual=${JSON.stringify({ result, calls })}`);
  if (calls.length !== 1 || calls[0].table !== "gateway_webhook_log"
    || calls[0].row.event_id !== "evt_test"
    || calls[0].row.event !== "order.paid"
    || JSON.stringify(calls[0].row.payload) !== JSON.stringify(event)) {
    throw new Error(`unexpected webhook log insert; actual=${JSON.stringify({ result, calls })}`);
  }
});

Deno.test("webhook replay event-id conflict is non-fatal", async () => {
  const { client, calls } = fakeClient({ code: "23505", message: "duplicate event id" });
  const result = await appendGatewayWebhookLog(client, "evt_replay", "order.paid", { event: "order.paid" });

  if (result.ok !== true || result.duplicate !== true || calls.length !== 1) {
    throw new Error(`expected duplicate to be non-fatal; actual=${JSON.stringify({ result, calls })}`);
  }
});

Deno.test("webhook log storage failures request a retry", async () => {
  const { client, calls } = fakeClient({ code: "08006", message: "database unavailable" });
  const result = await appendGatewayWebhookLog(client, null, "order.paid", { event: "order.paid" });

  if (result.ok !== false || result.error !== "database unavailable" || calls.length !== 1) {
    throw new Error(`expected storage failure to be returned; actual=${JSON.stringify({ result, calls })}`);
  }
});
