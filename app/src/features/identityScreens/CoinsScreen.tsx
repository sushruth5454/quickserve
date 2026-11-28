import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { Card, ErrorState, Header, InlineAlert, Screen, Skeleton, Text } from '../../components/ui';
import { getMyCoinBalance, listCoinHistory } from '../../lib/api';
import { DEFAULT_COINS_CONFIG, coinPaiseToCoins, type CoinLedgerEntry, type CoinsConfig } from '../../lib/coins';
import { getCoinsConfig } from '../../lib/coinsConfigApi';
import { formatINR } from '../../lib/money';
import { useTheme } from '../../theme';

const CONVERSION_NOTICE_KEY = 'quickserve.coins.denomination-notice.v2';

type WalletStatus = 'loading' | 'refreshing' | 'ready' | 'error';

type WalletReadState = {
  status: WalletStatus;
  balance: number | null;
  history: CoinLedgerEntry[] | null;
  config: CoinsConfig | null;
  error: string | null;
};

type NoticeReadState = {
  status: 'loading' | 'ready' | 'error';
  visible: boolean;
  error: string | null;
};

const LABELS: Record<CoinLedgerEntry['kind'], string> = {
  earn: 'Booking reward',
  bonus: 'Bonus',
  redeem: 'Used on booking',
  expire: 'Expired',
  clawback: 'Refund adjustment',
  admin: 'Account adjustment',
};

function readError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function useCoinsController() {
  const [wallet, setWallet] = useState<WalletReadState>({
    status: 'loading',
    balance: null,
    history: null,
    config: null,
    error: null,
  });
  const [notice, setNotice] = useState<NoticeReadState>({ status: 'loading', visible: false, error: null });
  const request = useRef(0);

  const loadNotice = useCallback(async (config: CoinsConfig, requestId: number) => {
    if (config.coin_paise !== 10) {
      if (request.current === requestId) setNotice({ status: 'ready', visible: false, error: null });
      return;
    }

    try {
      const noticeSeen = await AsyncStorage.getItem(CONVERSION_NOTICE_KEY);
      if (request.current === requestId) {
        setNotice({ status: 'ready', visible: noticeSeen !== 'seen', error: null });
      }
    } catch (error) {
      if (request.current === requestId) {
        setNotice({ status: 'error', visible: true, error: readError(error, 'Notice preference is unavailable.') });
      }
    }
  }, []);

  const load = useCallback(async () => {
    const requestId = ++request.current;
    setWallet((current) => ({
      ...current,
      status: current.balance === null || current.history === null || current.config === null ? 'loading' : 'refreshing',
      error: null,
    }));
    setNotice((current) => ({ ...current, status: 'loading', error: null }));

    try {
      const [balance, history, config] = await Promise.all([
        getMyCoinBalance(),
        listCoinHistory(),
        getCoinsConfig(),
      ]);
      if (request.current !== requestId) return;
      setWallet({ status: 'ready', balance, history, config, error: null });
      void loadNotice(config, requestId);
    } catch (error) {
      if (request.current !== requestId) return;
      setWallet((current) => ({
        ...current,
        status: 'error',
        error: readError(error, 'Coin information is unavailable.'),
      }));
    }
  }, [loadNotice]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        request.current += 1;
      };
    }, [load]),
  );

  const dismissConversionNotice = useCallback(async () => {
    const requestId = request.current;
    setNotice((current) => ({ ...current, status: 'loading', visible: false, error: null }));
    try {
      await AsyncStorage.setItem(CONVERSION_NOTICE_KEY, 'seen');
      if (request.current === requestId) setNotice({ status: 'ready', visible: false, error: null });
    } catch (error) {
      if (request.current === requestId) {
        setNotice({ status: 'error', visible: false, error: readError(error, 'Notice preference could not be saved.') });
      }
    }
  }, []);

  return { wallet, notice, load, dismissConversionNotice };
}

export default function CoinsScreen() {
  const t = useTheme();
  const { wallet, notice, load, dismissConversionNotice } = useCoinsController();
  const hasWallet = wallet.balance !== null && wallet.history !== null && wallet.config !== null;
  const config = wallet.config ?? DEFAULT_COINS_CONFIG;
  const earningDescription = config.coins_earning_enabled === true
    ? `Earn ${(config.earn_rate_bp / 100).toLocaleString('en-IN')}% on eligible completed bookings. `
    : config.coins_earning_enabled === false
      ? 'Earning is paused. '
      : 'Earning availability is unavailable. ';
  const redemptionDescription = config.coins_redemption_enabled === true
    ? `Use up to ${(config.redeem_cap_bp / 100).toLocaleString('en-IN')}% of a service value, capped by QuickServe revenue.`
    : config.coins_redemption_enabled === false
      ? 'Redemption is paused.'
      : 'Redemption availability is unavailable.';
  const emptyHistoryDescription = config.coins_earning_enabled === true
    ? 'Eligible completed bookings may earn coins.'
    : config.coins_earning_enabled === false
      ? 'Earning is paused. Existing coin activity will appear here.'
      : 'Earning availability is unavailable.';

  return (
    <Screen header={<Header title="Seva Coins" />} gap={t.spacing.section}>
      {wallet.status === 'error' ? (
        <ErrorState
          title={hasWallet ? 'Coin information may be out of date' : 'Coin information unavailable'}
          message={wallet.error}
          onRetry={() => void load()}
        />
      ) : null}
      {notice.status === 'error' && !notice.visible ? (
        <InlineAlert
          tone="neutral"
          title="Notice preference unavailable"
          message="This notice may appear again on this device."
        />
      ) : null}
      {notice.visible ? (
        <InlineAlert
          tone="info"
          title="Coin denomination updated"
          message="Coins are now 10 paise each. Your balance value hasn't changed."
          actionLabel="Got it"
          onAction={() => void dismissConversionNotice()}
        />
      ) : null}
      {wallet.status === 'loading' && !hasWallet ? <Skeleton height={150} radius={t.radii.lg} /> : null}
      {wallet.status === 'refreshing' && hasWallet ? (
        <Text variant="footnote" color="muted">Refreshing coin information…</Text>
      ) : null}
      {wallet.balance !== null && wallet.history !== null && wallet.config !== null ? (
        <>
          <Card variant="elevated" gap={t.spacing.md} style={{ alignItems: 'center', paddingVertical: t.spacing.xl }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="sparkles" size={28} color={t.colors.primaryText} />
            </View>
            <Text variant="display" tabular>{formatINR(wallet.balance)}</Text>
            <Text variant="callout" color="textSecondary">
              {coinPaiseToCoins(wallet.balance, config)} coins · {formatINR(wallet.balance)}
            </Text>
            <Text variant="footnote" color="muted" align="center">
              {earningDescription}
              {redemptionDescription}
              {` Valid for ${config.expiry_months} months.`}
            </Text>
          </Card>

          <View style={{ gap: t.spacing.sm }}>
            <Text variant="overline" color="muted" style={{ paddingHorizontal: t.spacing.lg }}>History</Text>
            <Card padding={0} gap={0} style={{ overflow: 'hidden' }}>
              {wallet.history.length === 0 ? (
                <View style={{ padding: t.spacing.xl, alignItems: 'center', gap: t.spacing.xs }}>
                  <Text variant="calloutStrong">No coin activity yet</Text>
                  <Text variant="footnote" color="muted" align="center">{emptyHistoryDescription}</Text>
                </View>
              ) : (
                wallet.history.map((entry, index) => (
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
        </>
      ) : null}
    </Screen>
  );
}
