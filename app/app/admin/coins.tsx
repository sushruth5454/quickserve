import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Switch, View } from 'react-native';
import { Button, Card, ErrorState, Header, InlineAlert, Input, Screen, Skeleton, Text, useToast } from '../../src/components/ui';
import {
  getAdminCoinSummary,
  getAdminCoinsConfig,
  setAdminCoinsConfig,
  setCoinsFeature,
  type AdminCoinSummary,
} from '../../src/lib/coinsConfigApi';
import type { CoinsConfig } from '../../src/lib/coins';
import { formatINR } from '../../src/lib/money';
import { useTheme } from '../../src/theme';

interface CoinsDraft {
  coinPaise: string;
  earnRateBp: string;
  perTxnCapPaise: string;
  firstTxnBonusPaise: string;
  monthlyCapPaise: string;
  redeemCapBp: string;
  expiryMonths: string;
  pilotBudgetPaise: string;
}

function toDraft(config: CoinsConfig): CoinsDraft {
  return {
    coinPaise: String(config.coin_paise),
    earnRateBp: String(config.earn_rate_bp),
    perTxnCapPaise: config.per_txn_cap_paise == null ? '' : String(config.per_txn_cap_paise),
    firstTxnBonusPaise: String(config.first_txn_bonus_paise),
    monthlyCapPaise: String(config.monthly_cap_paise),
    redeemCapBp: String(config.redeem_cap_bp),
    expiryMonths: String(config.expiry_months),
    pilotBudgetPaise: config.pilot_budget_paise == null ? '' : String(config.pilot_budget_paise),
  };
}

function wholeNumber(value: string, label: string, max = 2147483647): number {
  if (!/^\d+$/.test(value.trim())) throw new Error(`${label} must be a non-negative whole number.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > max) throw new Error(`${label} is out of range.`);
  return parsed;
}

function optionalWholeNumber(value: string, label: string): number | null {
  return value.trim() ? wholeNumber(value, label) : null;
}

function parseDraft(draft: CoinsDraft): CoinsConfig {
  const config: CoinsConfig = {
    coin_paise: wholeNumber(draft.coinPaise, 'Coin denomination'),
    earn_rate_bp: wholeNumber(draft.earnRateBp, 'Earn rate', 10000),
    per_txn_cap_paise: optionalWholeNumber(draft.perTxnCapPaise, 'Per-booking cap'),
    first_txn_bonus_paise: wholeNumber(draft.firstTxnBonusPaise, 'First-booking bonus'),
    monthly_cap_paise: wholeNumber(draft.monthlyCapPaise, 'Monthly cap'),
    redeem_cap_bp: wholeNumber(draft.redeemCapBp, 'Redemption cap', 10000),
    expiry_months: wholeNumber(draft.expiryMonths, 'Expiry months'),
    pilot_budget_paise: optionalWholeNumber(draft.pilotBudgetPaise, 'Pilot budget'),
  };
  if (![1, 10, 100].includes(config.coin_paise)) throw new Error('Coin denomination must be 1, 10, or 100 paise.');
  return config;
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.spacing.md }}>
      <Text variant="callout" color="textSecondary">{label}</Text>
      <Text variant="calloutStrong" tabular>{value}</Text>
    </View>
  );
}

export default function AdminCoinsScreen() {
  const t = useTheme();
  const toast = useToast();
  const [config, setConfig] = useState<CoinsConfig | null>(null);
  const [draft, setDraft] = useState<CoinsDraft | null>(null);
  const [summary, setSummary] = useState<AdminCoinSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingFeature, setSavingFeature] = useState<'coins_earning' | 'coins_redemption' | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    setConfig(null);
    setDraft(null);
    setSummary(null);
    void Promise.all([getAdminCoinsConfig(), getAdminCoinSummary()])
      .then(([nextConfig, nextSummary]) => {
        setConfig(nextConfig);
        setDraft(toDraft(nextConfig));
        setSummary(nextSummary);
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);
  useFocusEffect(load);

  const updateDraft = (key: keyof CoinsDraft, value: string) => {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  };

  const saveConfig = async () => {
    setFormError(null);
    let nextConfig: CoinsConfig;
    try {
      if (!draft) return;
      nextConfig = parseDraft(draft);
    } catch (e) {
      setFormError((e as Error).message);
      return;
    }
    setSavingConfig(true);
    try {
      const saved = await setAdminCoinsConfig(nextConfig);
      setConfig(saved);
      setDraft(toDraft(saved));
      setSummary(await getAdminCoinSummary());
      toast({ message: 'Coins configuration saved', tone: 'success' });
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSavingConfig(false);
    }
  };

  const setFeature = async (key: 'coins_earning' | 'coins_redemption', enabled: boolean) => {
    setSavingFeature(key);
    setFormError(null);
    try {
      await setCoinsFeature(key, enabled);
      if (key === 'coins_earning') {
        setConfig((current) => current ? { ...current, coins_earning_enabled: enabled } : current);
      } else {
        setConfig((current) => current ? { ...current, coins_redemption_enabled: enabled } : current);
      }
      toast({ message: `${key === 'coins_earning' ? 'Earning' : 'Redemption'} ${enabled ? 'enabled' : 'paused'}`, tone: 'success' });
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSavingFeature(null);
    }
  };

  return (
    <Screen header={<Header title="Coins" subtitle="Wallet policy and liability" />}>
      {loadError ? (
        <ErrorState message={loadError} onRetry={() => void load()} />
      ) : !config || !draft || !summary ? (
        <Skeleton height={520} radius={t.radii.lg} />
      ) : (
        <>
          <Card gap={t.spacing.md}>
            <Text variant="title3">Program summary</Text>
            <SummaryLine label="Earned and bonus issued" value={formatINR(summary.issued_paise)} />
            <SummaryLine label="Redeemed" value={formatINR(summary.redeemed_paise)} />
            <SummaryLine label="Expired" value={formatINR(summary.expired_paise)} />
            <SummaryLine label="Outstanding liability" value={formatINR(summary.outstanding_paise)} />
            <SummaryLine
              label="Pilot budget"
              value={summary.budget_paise == null ? 'No cap' : `${formatINR(summary.budget_paise)} · ${formatINR(summary.budget_left_paise ?? 0)} left`}
            />
          </Card>

          <Card gap={t.spacing.md}>
            <Text variant="title3">Feature switches</Text>
            <Text variant="footnote" color="muted">Switches take effect on the server immediately. Existing wallet balances are retained.</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.md }}>
              <Text variant="calloutStrong" style={{ flex: 1 }}>Earning</Text>
              <Switch
                value={!!config.coins_earning_enabled}
                disabled={savingFeature != null}
                onValueChange={(enabled) => void setFeature('coins_earning', enabled)}
              />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.md }}>
              <Text variant="calloutStrong" style={{ flex: 1 }}>Redemption</Text>
              <Switch
                value={!!config.coins_redemption_enabled}
                disabled={savingFeature != null}
                onValueChange={(enabled) => void setFeature('coins_redemption', enabled)}
              />
            </View>
          </Card>

          <Card gap={t.spacing.md}>
            <Text variant="title3">Earning, redemption and expiry</Text>
            <Text variant="footnote" color="muted">Amounts are integer paise; 100 basis points = 1%. Blank per-booking cap or budget means uncapped. The server validates and enforces every money decision.</Text>
            <Input label="Coin denomination (paise; 1, 10 or 100)" keyboardType="number-pad" value={draft.coinPaise} onChangeText={(value) => updateDraft('coinPaise', value)} />
            <Input label="Earn rate (basis points)" keyboardType="number-pad" value={draft.earnRateBp} onChangeText={(value) => updateDraft('earnRateBp', value)} />
            <Input label="Per-booking cap (paise; blank = none)" keyboardType="number-pad" value={draft.perTxnCapPaise} onChangeText={(value) => updateDraft('perTxnCapPaise', value)} />
            <Input label="First completed booking bonus (paise)" keyboardType="number-pad" value={draft.firstTxnBonusPaise} onChangeText={(value) => updateDraft('firstTxnBonusPaise', value)} />
            <Input label="Monthly earning cap (paise)" keyboardType="number-pad" value={draft.monthlyCapPaise} onChangeText={(value) => updateDraft('monthlyCapPaise', value)} />
            <Input label="Redemption cap (basis points)" keyboardType="number-pad" value={draft.redeemCapBp} onChangeText={(value) => updateDraft('redeemCapBp', value)} />
            <Input label="Expiry (months)" keyboardType="number-pad" value={draft.expiryMonths} onChangeText={(value) => updateDraft('expiryMonths', value)} />
            <Input label="Pilot budget (paise; blank = none)" keyboardType="number-pad" value={draft.pilotBudgetPaise} onChangeText={(value) => updateDraft('pilotBudgetPaise', value)} />
            <InlineAlert message={formError} />
            <Button title="Save coins configuration" loading={savingConfig} onPress={() => void saveConfig()} />
          </Card>
        </>
      )}
    </Screen>
  );
}
