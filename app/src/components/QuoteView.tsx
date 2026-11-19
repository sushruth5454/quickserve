import { View } from 'react-native';
import { customerDueNow, formatINR, requiredTotal } from '../lib/money';
import type { Quote, QuoteItemKind, QuoteStatus } from '../lib/types';
import { useTheme } from '../theme';
import { Badge, Card, Divider, InlineAlert, PriceRow, Text, type Tone } from './ui';

const statusText: Record<QuoteStatus, [string, Tone]> = {
  sent: ['Awaiting approval', 'warning'],
  approved_pending_payment: ['Approved · payment due', 'warning'],
  approved: ['Approved', 'success'],
  rejected: ['Declined', 'danger'],
  superseded: ['Replaced', 'neutral'],
};

export const kindLabel: Record<QuoteItemKind, string> = {
  labour: 'Labour',
  part: 'Part',
  other: 'Other',
  material: 'Material',
  package: 'Package',
  per_unit: 'Per-unit service',
  travel: 'Travel',
  rental: 'Rental',
  discount: 'Discount',
  addon: 'Add-on',
};
const groupLabel: Record<QuoteItemKind, string> = {
  labour: 'Labour',
  part: 'Parts',
  other: 'Other charges',
  material: 'Materials',
  package: 'Packages',
  per_unit: 'Services',
  travel: 'Travel',
  rental: 'Rentals',
  discount: 'Discounts',
  addon: 'Add-ons',
};

interface Props {
  quote: Quote;
  visitFee: number;
  platformFee: number;
  alreadyPaid: number;
  counterpartName?: string;
  coinDiscountPreview?: number;
  coinPaid?: number;
  /** [min, max] typical total in rupees for this category. */
  typical?: [number, number] | null;
  title?: string;
}

/** Itemised quote. Approve/decline actions live in the screen's sticky footer, not inside the card. */
export function QuoteView({
  quote,
  visitFee,
  platformFee,
  alreadyPaid,
  counterpartName,
  coinDiscountPreview = 0,
  coinPaid = 0,
  typical,
  title,
}: Props) {
  const t = useTheme();
  const coinDiscount = (quote.coin_discount ?? 0) > 0 ? quote.coin_discount! : coinDiscountPreview;
  const grossTotal = requiredTotal(quote.total, visitFee, platformFee);
  const total = Math.max(0, grossTotal - coinDiscount);
  const cashPaid = Math.max(0, alreadyPaid - coinPaid);
  const due = customerDueNow(total, cashPaid);
  const open = quote.status === 'sent' || quote.status === 'approved_pending_payment';
  const [label, tone] = statusText[quote.status];
  const aboveTypical = typical ? grossTotal > typical[1] * 100 : false;
  const groups = (['labour', 'part', 'other'] as const)
    .map((kind) => ({ kind, items: quote.quote_items.filter((i) => i.kind === kind) }))
    .filter((g) => g.items.length > 0);
  const first = counterpartName?.split(' ')[0];
  const heading =
    title ?? (quote.is_change_order ? 'Change order' : quote.version > 1 ? 'Revised quote' : 'Quote');

  return (
    <Card gap={t.spacing.lg} variant="elevated">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: t.spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Text variant="title3">{heading}</Text>
          <Text variant="footnote" color="muted">
            {quote.quote_items.length} item{quote.quote_items.length === 1 ? '' : 's'}
          </Text>
        </View>
        {quote.status !== 'sent' ? <Badge label={label} tone={tone} dot /> : null}
      </View>

      <View style={{ gap: t.spacing.lg }}>
        {groups.map((g) => (
          <View key={g.kind} style={{ gap: t.spacing.sm }}>
            <Text variant="overline" color="muted">
              {groupLabel[g.kind]}
            </Text>
            {g.items.map((item) => (
              <View key={item.id} style={{ flexDirection: 'row', gap: t.spacing.md, alignItems: 'flex-start' }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="callout">{item.title}</Text>
                  {Number(item.qty) !== 1 || item.bill_photo_url ? (
                    <Text variant="footnote" color="muted">
                      {[Number(item.qty) !== 1 ? `${item.qty} × ${formatINR(item.unit_price)}` : null, item.bill_photo_url ? 'Bill photo attached' : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  ) : null}
                </View>
                <Text variant="callout" tabular>
                  {formatINR(Math.round(Number(item.qty) * item.unit_price))}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
      {quote.note ? (
        <View style={{ backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.sm, padding: t.spacing.md, gap: 2 }}>
          <Text variant="captionStrong" color="muted">
            {first ? `Note from ${first}` : 'Note'}
          </Text>
          <Text variant="footnote" color="textSecondary">
            {quote.note}
          </Text>
        </View>
      ) : null}

      <Divider />
      <View style={{ gap: 10 }}>
        <PriceRow label="Subtotal" amount={quote.total} />
        <PriceRow label="Platform fee" amount={platformFee} />
        {visitFee > quote.total ? <PriceRow label="Minimum visit charge" amount={visitFee - quote.total} emphasis="muted" /> : null}
        {coinDiscount > 0 ? <PriceRow label="Seva Coins" amount={-coinDiscount} hint="Funded by QuickServe" emphasis="credit" /> : null}
        <PriceRow label={coinDiscount > 0 ? 'Total after coins' : 'Total'} amount={total} />
        {cashPaid > 0 ? (
          <PriceRow label="Paid so far (incl. visit fee)" amount={-Math.min(cashPaid, total)} emphasis="credit" />
        ) : null}
      </View>
      {open ? (
        <View style={{ gap: t.spacing.md }}>
          <Divider dashed />
          <PriceRow label={quote.is_change_order ? 'Extra to pay now' : 'To pay now'} amount={due} emphasis="total" />
        </View>
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
    </Card>
  );
}
