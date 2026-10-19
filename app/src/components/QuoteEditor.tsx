import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { formatINR, quoteSubtotals, rupeesToPaise } from '../lib/money';
import { colors, font, minTouch, radius, spacing } from '../lib/theme';
import type { QuoteItemDraft, QuoteItemKind } from '../lib/types';
import { Button } from './Button';
import { Chip, ErrorText } from './Screen';

interface Line {
  key: string;
  kind: QuoteItemKind;
  title: string;
  qty: string;
  unitPrice: string;
}

const KINDS: { kind: QuoteItemKind; label: string }[] = [
  { kind: 'labour', label: 'Labour' },
  { kind: 'part', label: 'Part' },
  { kind: 'other', label: 'Other' },
];

let seq = 0;
const newLine = (kind: QuoteItemKind = 'labour'): Line => ({
  key: `l${++seq}`,
  kind,
  title: '',
  qty: '1',
  unitPrice: '',
});

interface Props {
  isChangeOrder?: boolean;
  submitting?: boolean;
  onSubmit: (items: QuoteItemDraft[], note: string) => void;
}

export function QuoteEditor({ isChangeOrder, submitting, onSubmit }: Props) {
  const [lines, setLines] = useState<Line[]>([newLine('labour')]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(
    () =>
      lines.map((l) => ({
        kind: l.kind,
        title: l.title.trim(),
        qty: Number(l.qty),
        unit_price: rupeesToPaise(Number(l.unitPrice)),
      })),
    [lines],
  );
  const totals = useMemo(
    () =>
      quoteSubtotals(
        parsed
          .filter((p) => Number.isFinite(p.qty) && Number.isFinite(p.unit_price))
          .map((p) => ({ kind: p.kind, qty: p.qty, unitPrice: p.unit_price })),
      ),
    [parsed],
  );

  const update = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const submit = () => {
    const invalid = parsed.find(
      (p) => !p.title || !(p.qty > 0) || !Number.isFinite(p.unit_price) || p.unit_price < 0,
    );
    if (invalid || parsed.length === 0) {
      setError('Every line needs a title, a quantity above 0 and a price.');
      return;
    }
    setError(null);
    onSubmit(parsed, note.trim());
  };

  return (
    <View style={styles.wrap}>
      <Text style={font.heading}>{isChangeOrder ? 'Change order (revised quote)' : 'Itemized quote'}</Text>
      {lines.map((l, i) => (
        <View key={l.key} style={styles.line}>
          <View style={styles.kinds}>
            {KINDS.map((k) => (
              <Chip key={k.kind} label={k.label} selected={l.kind === k.kind} onPress={() => update(l.key, { kind: k.kind })} />
            ))}
            {lines.length > 1 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove line ${i + 1}`}
                onPress={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                style={styles.remove}
              >
                <Text style={{ color: colors.danger, fontWeight: '600' }}>Remove</Text>
              </Pressable>
            )}
          </View>
          <TextInput
            placeholder={l.kind === 'part' ? 'Part name (e.g. Capacitor 45uF)' : 'Description (e.g. Gas refill)'}
            placeholderTextColor={colors.muted}
            value={l.title}
            onChangeText={(t) => update(l.key, { title: t })}
            style={styles.input}
            accessibilityLabel={`Line ${i + 1} title`}
          />
          <View style={styles.row}>
            <TextInput
              placeholder="Qty"
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
              value={l.qty}
              onChangeText={(t) => update(l.key, { qty: t })}
              style={[styles.input, styles.qty]}
              accessibilityLabel={`Line ${i + 1} quantity`}
            />
            <TextInput
              placeholder="Unit price ₹"
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
              value={l.unitPrice}
              onChangeText={(t) => update(l.key, { unitPrice: t })}
              style={[styles.input, styles.flex]}
              accessibilityLabel={`Line ${i + 1} unit price in rupees`}
            />
          </View>
          {l.kind === 'part' && Number(l.unitPrice) * Number(l.qty) > 500 && (
            <Text style={font.caption}>Parts above ₹500 need a bill photo — share it in chat.</Text>
          )}
        </View>
      ))}
      <Button title="+ Add line" variant="secondary" onPress={() => setLines((ls) => [...ls, newLine('part')])} />
      <TextInput
        placeholder="Note for the customer (optional)"
        placeholderTextColor={colors.muted}
        value={note}
        onChangeText={setNote}
        style={styles.input}
        accessibilityLabel="Quote note"
      />
      <View style={styles.totals}>
        <Text style={font.caption}>Labour {formatINR(totals.labour)}</Text>
        <Text style={font.caption}>Parts {formatINR(totals.parts)}</Text>
        <Text style={font.caption}>Other {formatINR(totals.other)}</Text>
        <Text style={font.heading}>Quote total {formatINR(totals.total)}</Text>
      </View>
      <ErrorText message={error} />
      <Button title={isChangeOrder ? 'Send change order' : 'Send quote'} onPress={submit} loading={submitting} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  line: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  kinds: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', flexWrap: 'wrap' },
  remove: { marginLeft: 'auto', minHeight: minTouch, justifyContent: 'center', paddingHorizontal: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  input: {
    minHeight: minTouch,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  qty: { width: 80 },
  flex: { flex: 1 },
  totals: { gap: spacing.xs, alignItems: 'flex-end' },
});
