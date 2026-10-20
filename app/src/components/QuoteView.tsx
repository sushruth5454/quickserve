import { View } from 'react-native';
import { amountDue, formatINR, requiredTotal } from '../lib/money';
import type { Quote, QuoteItemKind, QuoteStatus } from '../lib/types';
import { useTheme } from '../theme';
import { Badge, Button, Card, Divider, InlineAlert, PriceRow, Text, type Tone } from './ui';

const statusText: Record<QuoteStatus, [string, Tone]> = {
  sent: ['Awaiting approval', 'warning'],
  approved_pending_payment: ['Approved · payment due', 'warning'],
  approved: ['Approved', 'success'],
  rejected: ['Rejected', 'danger'],
  superseded: ['Replaced', 'neutral'],
};

export const kindLabel: Record<QuoteItemKind, string> = { labour: 'Labour', part: 'Part', other: 'Other' };

interface Props {
  quote: Quote;
  visitFee: number;
  platformFee: number;
  alreadyPaid: number;
  counterpartName?: string;
  /** [min, max] typical total in rupees for this category. */
  typical?: [number, number] | null;
  canRespond?: boolean;
  busy?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
  title?: string;
}

export function QuoteView({
  quote,
  visitFee,
  platformFee,
  alreadyPaid,
  typical,
  canRespond,
  busy,
  onApprove,
  onReject,
  title,
}: Props) {
  const t = useTheme();
  const total = requiredTotal(quote.total, visitFee, platformFee);
  const due = amountDue({ quoteTotal: quote.total, visitFee, platformFee, alreadyPaid });
  const open = quote.status === 'sent' || quote.status === 'approved_pending_payment';
  const [label, tone] = statusText[quote.status];
  const aboveTypical = typical ? total > typical[1] * 100 : false;

  return (
    <Card gap={t.spacing.md} elevation="md">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: t.spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Text variant="title3">{title ?? `${quote.is_change_order ? 'Change order' : 'Quote'} v${quote.version}`}</Text>
          <Text variant="caption" color="muted">
            {quote.quote_items.length} item{quote.quote_items.length === 1 ? '' : 's'}
          </Text>
        </View>
        <Badge label={label} tone={tone} dot />
      </View>

      <View style={{ gap: t.spacing.md }}>
        {quote.quote_items.map((item) => (
          <View key={item.id} style={{ flexDirection: 'row', gap: t.spacing.md, alignItems: 'flex-start' }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="micro" color="muted" uppercase>
                {kindLabel[item.kind]}
              </Text>
              <Text variant="callout" numberOfLines={2}>
                {item.title}
                {Number(item.qty) !== 1 ? (
                  <Text variant="callout" color="muted">{`  × ${item.qty}`}</Text>
                ) : null}
              </Text>
              {item.bill_photo_url ? (
                <Text variant="caption" color="primary">
                  Bill photo attached
                </Text>
              ) : null}
            </View>
            <Text variant="bodyStrong" tabular>
              {formatINR(Math.round(Number(item.qty) * item.unit_price))}
            </Text>
          </View>
        ))}
      </View>

      {quote.note ? (
        <View style={{ backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.sm, padding: t.spacing.md }}>
          <Text variant="caption" color="textSecondary">
            “{quote.note}”
          </Text>
        </View>
      ) : null}

      <Divider />
      <View style={{ gap: t.spacing.sm }}>
        {quote.subtotal_labour > 0 ? <PriceRow label="Labour" amount={quote.subtotal_labour} /> : null}
        {quote.subtotal_parts > 0 ? <PriceRow label="Parts" amount={quote.subtotal_parts} hint="Passed through at cost" /> : null}
        {quote.subtotal_other > 0 ? <PriceRow label="Other" amount={quote.subtotal_other} /> : null}
        <PriceRow label="Platform fee" amount={platformFee} />
        {visitFee > quote.total ? <PriceRow label="Minimum visit charge" amount={visitFee - quote.total} emphasis="muted" /> : null}
        <PriceRow label="Total" amount={total} emphasis="normal" />
        {alreadyPaid > 0 ? (
          <PriceRow label="Paid so far (incl. visit fee)" amount={-Math.min(alreadyPaid, total)} emphasis="credit" />
        ) : null}
      </View>
      {open ? (
        <>
          <Divider dashed />
          <PriceRow
            label={quote.is_change_order ? 'Extra to pay now' : 'Pay now to start work'}
            amount={due}
            emphasis="total"
          />
        </>
      ) : null}

      {typical && quote.status === 'sent' ? (
        aboveTypical ? (
          <InlineAlert
            tone="warning"
            message={`This is higher than the usual ${formatINR(typical[0] * 100)}–${formatINR(typical[1] * 100)} for this job. Ask your provider why before approving.`}
          />
        ) : (
          <InlineAlert tone="success" icon="shield-checkmark" message="Within the typical range for this job." />
        )
      ) : null}

      {canRespond && quote.status === 'sent' ? (
        <View style={{ flexDirection: 'row', gap: t.spacing.md, marginTop: t.spacing.xs }}>
          <Button title="Reject" variant="outline" onPress={() => onReject?.()} disabled={busy} style={{ flex: 1 }} />
          <Button
            title={due > 0 ? 'Approve & pay' : 'Approve'}
            variant="success"
            leftIcon="checkmark-circle"
            onPress={() => onApprove?.()}
            loading={busy}
            style={{ flex: 1.6 }}
          />
        </View>
      ) : null}
    </Card>
  );
}
