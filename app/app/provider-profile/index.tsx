import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { Share, Switch, View } from 'react-native';
import { Avatar, Button, Card, ErrorState, FullScreenLoader, Header, InlineAlert, ListItem, Screen, Text, useConfirm, useToast } from '../../src/components/ui';
import { GoLiveStatusCard } from '../../src/features/providerOnboarding/GoLiveStatusCard';
import { ProgressBar } from '../../src/features/providerOnboarding/parts';
import { SECTIONS } from '../../src/features/providerOnboarding/sections';
import { useOnboardingData } from '../../src/features/providerOnboarding/useOnboardingData';
import { onboardingApi } from '../../src/lib/onboarding';
import { completeness, stepDone, type StepKey } from '../../src/lib/onboarding/completeness';
import { useTheme } from '../../src/theme';

const ICONS: Record<Exclude<StepKey, 'review'>, 'person-outline' | 'construct-outline' | 'map-outline' | 'time-outline' | 'images-outline' | 'card-outline'> = {
  basics: 'person-outline',
  services: 'construct-outline',
  area: 'map-outline',
  hours: 'time-outline',
  portfolio: 'images-outline',
  payouts: 'card-outline',
};

/** Me → Provider profile: status, completeness, sectioned editing, preview/share, holiday mode, deactivate. */
export default function ProviderProfileHub() {
  const t = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, reload } = useOnboardingData();
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const needsOnboarding = !!data && !data.state.provider;
  useEffect(() => {
    if (needsOnboarding) router.replace('/onboarding');
  }, [needsOnboarding]);

  if (error && !data) {
    return (
      <Screen header={<Header title="Provider profile" />}>
        <ErrorState message={error} onRetry={() => void reload()} />
      </Screen>
    );
  }
  if (!data) return <FullScreenLoader />;
  const { state } = data;
  const p = state.provider;
  if (!p) return <FullScreenLoader />;
  const c = completeness(state.checks);
  const submitted = !!p.submitted_at;
  const open = (s: StepKey) => router.push({ pathname: '/provider-profile/[section]', params: { section: s } });

  const run = async (key: string, fn: () => Promise<void>, ok?: string) => {
    setBusy(key);
    setActionError(null);
    try {
      await fn();
      await reload();
      if (ok) toast({ message: ok, tone: 'success' });
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const share = async () => {
    const url = Linking.createURL(`/provider/${p.id}`);
    await Share.share({ message: `Book me on QuickServe: ${url}`, url }).catch(() => undefined);
  };

  const deactivate = async () => {
    const ok = await confirm({
      title: 'Deactivate provider account?',
      message: 'You will be hidden from customers and cannot receive new bookings. Ongoing jobs and pending payouts continue. You can reactivate any time.',
      confirmLabel: 'Deactivate',
      destructive: true,
    });
    if (ok) await run('deactivate', () => onboardingApi.deactivate(null), 'Account deactivated');
  };

  return (
    <Screen header={<Header title="Provider profile" />} gap={t.spacing.xl} onRefresh={() => void reload()} refreshing={false}>
      <InlineAlert message={actionError} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
        <Avatar name={state.profile?.full_name ?? 'You'} uri={state.profile?.avatar_url} size={64} verified={state.go_live.state === 'live'} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="title2">{state.profile?.full_name || 'Your name'}</Text>
          <Text variant="footnote" color="muted">
            {[p.base_area, p.city].filter(Boolean).join(', ') || 'Service area not set'}
          </Text>
        </View>
      </View>

      <GoLiveStatusCard
        goLive={state.go_live}
        docTypes={data.docTypes}
        onFix={(s) => open(s)}
        onContinue={() => router.push('/onboarding')}
      />

      <Card gap={t.spacing.md}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="title3">Profile strength</Text>
          <Text variant="title3" tabular>
            {c.score}%
          </Text>
        </View>
        <ProgressBar value={c.score / 100} tone={c.score >= 90 ? 'success' : 'primary'} />
        {c.tips.slice(0, 3).map((tip) => (
          <ListItem key={tip.key} icon={tip.required ? 'alert-circle-outline' : 'bulb-outline'} title={tip.text} chevron onPress={() => open(tip.step)} />
        ))}
      </Card>

      <Card padding={0} gap={0}>
        {(Object.keys(SECTIONS) as (keyof typeof SECTIONS)[]).map((k) => (
          <ListItem
            key={k}
            icon={ICONS[k]}
            title={SECTIONS[k].title}
            value={stepDone(k, state) ? undefined : 'To do'}
            chevron
            onPress={() => open(k)}
          />
        ))}
        <ListItem icon="checkmark-done-outline" title={submitted ? 'Agreement & submission' : 'Review & submit'} value={submitted ? undefined : 'To do'} chevron onPress={() => open('review')} />
      </Card>

      <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
        <Button
          title="Preview"
          variant="outline"
          leftIcon="eye-outline"
          onPress={() => router.push({ pathname: '/provider/[id]', params: { id: p.id, preview: '1' } })}
          style={{ flex: 1 }}
        />
        <Button title="Share profile" variant="outline" leftIcon="share-social-outline" onPress={() => void share()} disabled={state.go_live.state !== 'live'} style={{ flex: 1 }} />
      </View>

      <Card gap={t.spacing.sm}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="calloutStrong">Holiday mode</Text>
            <Text variant="footnote" color="muted">
              Pause new bookings. Customers still see your profile marked as unavailable.
            </Text>
          </View>
          <Switch
            accessibilityLabel="Holiday mode"
            value={p.paused}
            disabled={busy === 'pause' || !!p.deactivated_at}
            onValueChange={(v) => void run('pause', () => onboardingApi.setPaused(v), v ? 'Holiday mode on' : 'Holiday mode off')}
            trackColor={{ true: t.colors.primary, false: t.colors.border }}
          />
        </View>
      </Card>

      {p.deactivated_at ? (
        <Button title="Reactivate provider account" onPress={() => void run('reactivate', () => onboardingApi.reactivate(), 'Account reactivated')} loading={busy === 'reactivate'} />
      ) : (
        <Button title="Deactivate provider account" variant="destructiveGhost" onPress={() => void deactivate()} loading={busy === 'deactivate'} />
      )}
    </Screen>
  );
}