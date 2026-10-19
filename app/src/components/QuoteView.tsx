import { StyleSheet, Text, View } from 'react-native';
import { amountDue, formatINR, requiredTotal } from '../lib/money';
import { colors, font, spacing } from '../lib/theme';
import type { Quote, QuoteStatus } from '../lib/types';
import { Button } from './Button';
import { Card } from './Screen';

const statusText: Record<QuoteStatus, string> = {
  sent: 'Awaiting your approval',
  approved_pending_payment: 'Approved — payment due',
  approved: 'Approved',
  rejected: 'Rejected',
  superseded: 'Superseded',
};

interface Props {
  quote: Quote;
  visitFee: number;
  platformFee: number;
  alreadyPaid: number;
  canRespond?: boolean;
  busy?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
}

export function QuoteView({ quote, visitFee, platformFee, alreadyPaid, canRespond, busy, onApprove, onReject }: Props) {
  const total = requiredTotal(quote.total, visitFee, platformFee);
  const due = amountDue({ quoteTotal: quote.total, visitFee, platformFee, alreadyPaid });
  const open = quote.status === 'sent' || quote.status === 'approved_pending_payment';
  return (
    <Card>
      <View style={styles.header}>
        <Text style={font.heading}>
          {quote.is_change_order ? 'Change order' : 'Quote'} v{quote.version}
        </Text>
        <Text style={[styles.status, quote.status === 'approved' && { color: colors.success }]}>
          {statusText[quote.status]}
        </Text>
      </View>
      {quote.quote_items.map((item) => (
        <View key={item.id} style={styles.line}>
          <Text style={[font.body, styles.flex]} numberOfLines={2}>
            <Text style={styles.kind}>{item.kind.toUpperCase()} </Text>
            {item.title} {Number(item.qty) !== 1 ? `× ${item.qty}` : ''}
          </Text>
          <Text style={font.body}>{formatINR(Math.round(Number(item.qty) * item.unit_price))}</Text>
        </View>
      ))}
      {quote.note ? <Text style={font.caption}>Note: {quote.note}</Text> : null}
      <View style={styles.divider} />
      <Row label="Labour" value={quote.subtotal_labour} />
      <Row label="Parts (no commission)" value={quote.subtotal_parts} />
      {quote.subtotal_other > 0 && <Row label="Other" value={quote.subtotal_other} />}
      <Row label="Platform fee" value={platformFee} />
      <Row label="Total" value={total} bold />
      <Row label="Already paid (incl. visit fee)" value={-Math.min(alreadyPaid, total)} />
      {open && <Row label={quote.is_change_order ? 'Extra to pay now' : 'Pay now to start work'} value={due} bold />}
      {canRespond && quote.status === 'sent' && (
        <View style={styles.actions}>
          <Button title="Reject" variant="secondary" onPress={() => onReject?.()} disabled={busy} style={styles.flex} />
          <Button title="Approve" onPress={() => onApprove?.()} loading={busy} style={styles.flex} />
        </View>
      )}
    </Card>
  );
}

function Row({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={[font.body, bold && styles.bold]}>{label}</Text>
      <Text style={[font.body, bold && styles.bold]}>{formatINR(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  status: { ...font.caption, fontWeight: '600', color: colors.warning },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  kind: { fontSize: 11, color: colors.muted, fontWeight: '700' },
  flex: { flex: 1 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
  bold: { fontWeight: '700' },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
});
