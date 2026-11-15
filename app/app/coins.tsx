import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Card, ErrorState, Header, Screen, Skeleton, Text } from '../src/components/ui';
import { getMyCoinBalance, listCoinHistory } from '../src/lib/api';
import { coinPaiseToCoins, type CoinLedgerEntry } from '../src/lib/coins';
import { formatINR } from '../src/lib/money';
import { useTheme } from '../src/theme';

const LABELS: Record<CoinLedgerEntry['kind'], string> = {
  earn: 'Booking reward',
  bonus: 'Bonus',
  redeem: 'Used on booking',
  expire: 'Expired',
  clawback: 'Refund adjustment',
  admin: 'Account adjustment',
};

export default function CoinsScreen() {
  const t = useTheme();
  const [balance, setBalance] = useState<number | null>(null);
  const [history, setHistory] = useState<CoinLedgerEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([getMyCoinBalance(), listCoinHistory()])
      .then(([nextBalance, nextHistory]) => {
        setBalance(nextBalance);
        setHistory(nextHistory);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useFocusEffect(load);

  return (
    <Screen header={<Header title="Seva Coins" />} gap={t.spacing.section}>
      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {balance == null ? (
        <Skeleton height={150} radius={t.radii.lg} />
      ) : (
        <Card variant="elevated" gap={t.spacing.md} style={{ alignItems: 'center', paddingVertical: t.spacing.xl }}>
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="sparkles" size={28} color={t.colors.primaryText} />
          </View>
          <Text variant="display" tabular>{formatINR(balance)}</Text>
          <Text variant="callout" color="textSecondary">
            {coinPaiseToCoins(balance)} coins available
          </Text>
          <Text variant="footnote" color="muted" align="center">
            Earn 2% after completed bookings. Use up to 10% of a service value, capped by QuickServe revenue.
          </Text>
        </Card>
      )}

      <View style={{ gap: t.spacing.sm }}>
        <Text variant="overline" color="muted" style={{ paddingHorizontal: t.spacing.lg }}>History</Text>
        <Card padding={0} gap={0} style={{ overflow: 'hidden' }}>
          {history.length === 0 ? (
            <View style={{ padding: t.spacing.xl, alignItems: 'center', gap: t.spacing.xs }}>
              <Text variant="calloutStrong">No coin activity yet</Text>
              <Text variant="footnote" color="muted" align="center">
                Complete an in-app booking to earn your first reward.
              </Text>
            </View>
          ) : (
            history.map((entry, index) => (
              <View
                key={entry.id}
                style={{
                  padding: t.spacing.lg,
                  gap: t.spacing.xs,
                  borderTopWidth: index ? 1 : 0,
                  borderTopColor: t.colors.border,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.spacing.md }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="calloutStrong">{LABELS[entry.kind]}</Text>
                    <Text variant="footnote" color="muted">
                      {new Date(entry.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {entry.expires_at ? ` · expires ${new Date(entry.expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}
                    </Text>
                  </View>
                  <Text variant="calloutStrong" color={entry.delta > 0 ? 'successText' : 'text'} tabular>
                    {entry.delta > 0 ? '+' : ''}{formatINR(entry.delta)}
                  </Text>
                </View>
                {entry.reason ? <Text variant="footnote" color="textSecondary">{entry.reason}</Text> : null}
              </View>
            ))
          )}
        </Card>
      </View>
      <Text variant="caption" color="muted" align="center">
        Seva Coins are not cash, are non-transferable, and can only be used inside QuickServe.
      </Text>
    </Screen>
  );
}
