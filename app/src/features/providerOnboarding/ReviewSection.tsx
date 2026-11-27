import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Card, InlineAlert, ListItem, Screen, Text, useToast } from '../../components/ui';
import { onboardingApi } from '../../lib/onboarding';
import { completeness, type StepKey } from '../../lib/onboarding/completeness';
import { PROVIDER_TERMS_SUMMARY } from '../../lib/onboarding/copy';
import { useTheme } from '../../theme';
import { GoLiveStatusCard } from './GoLiveStatusCard';
import { Intro, ProgressBar, SectionFooter, type SectionProps, useOnboardingReadState } from './parts';

const CHECK_LABEL: Record<string, string> = {
  name: 'Your name',
  photo: 'Profile photo',
  bio: 'Short bio',
  languages: 'Languages',
  services: 'At least one service',
  specialisations: 'Specialisations',
  area: 'Service area',
  hours: 'Working hours',
  portfolio: 'Work photos',
  payout: 'Payout account',
};

export function ReviewSection({ data, reload, header, mode, onDone, onBack, onJump }: SectionProps & { onJump: (step: StepKey) => void }) {
  const t = useTheme();
  const toast = useToast();
  const state = data.state;
  const c = completeness(state.checks);
  const submitted = !!state.provider?.submitted_at;
  const acceptedCurrent = submitted && state.provider?.terms_version === state.terms_version;
  const readState = useOnboardingReadState();
  const [accepted, setAccepted] = useState(acceptedCurrent);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!c.requiredDone) return setError('Complete the required items first.');
    if (!accepted) return setError('Please accept the provider agreement.');
    setBusy(true);
    setError(null);
    try {
      await onboardingApi.submitProfile(state.terms_version);
      await reload({ afterMutation: true });
      toast({ message: submitted ? 'Profile updated' : 'Profile submitted', tone: 'success' });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const stepOf: Record<string, StepKey> = {
    name: 'basics',
    photo: 'basics',
    bio: 'basics',
    languages: 'basics',
    services: 'services',
    specialisations: 'services',
    area: 'area',
    hours: 'hours',
    portfolio: 'portfolio',
    payout: 'payouts',
  };

  return (
    <Screen
      header={header}
      gap={t.spacing.xl}
      footer={
        <SectionFooter
          primary={submitted ? (acceptedCurrent ? 'Done' : 'Accept & save') : 'Submit profile'}
          onPrimary={() => (acceptedCurrent && mode === 'edit' ? onDone() : void submit())}
          loading={busy}
          disabled={!c.requiredDone || !accepted}
          onBack={onBack}
        />
      }
    >
      <Intro title={submitted ? 'Your profile' : 'Review & submit'} subtitle="Check how customers will see you, then submit. You can edit any section later from Me → Provider profile." />
      <InlineAlert message={error} />
      {submitted && readState?.state.status !== 'stale' ? <GoLiveStatusCard goLive={state.go_live} docTypes={data.docTypes} compact /> : null}

      <Card gap={t.spacing.md}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Text variant="title3">Profile {c.score}% complete</Text>
          <Text variant="footnote" color="muted">
            {c.requiredDone ? 'Ready to submit' : `${c.missingRequired.length} required left`}
          </Text>
        </View>
        <ProgressBar value={c.score / 100} tone={c.requiredDone ? 'success' : 'primary'} />
        <View style={{ marginHorizontal: -t.spacing.lg }}>
          {state.checks.map((k) => (
            <ListItem
              key={k.key}
              icon={k.ok ? 'checkmark-circle' : k.required ? 'alert-circle-outline' : 'ellipse-outline'}
              iconTint={k.ok ? t.colors.success : k.required ? t.colors.danger : t.colors.muted}
              title={CHECK_LABEL[k.key] ?? k.key}
              subtitle={k.ok ? undefined : k.required ? 'Required' : 'Recommended'}
              chevron={!k.ok}
              onPress={k.ok ? undefined : () => onJump(stepOf[k.key] ?? 'basics')}
            />
          ))}
        </View>
      </Card>

      {state.provider ? (
        <Button
          title="Preview your public profile"
          variant="outline"
          leftIcon="eye-outline"
          onPress={() => router.push({ pathname: '/provider/[id]', params: { id: state.provider!.id, preview: '1' } })}
        />
      ) : null}

      <Card gap={t.spacing.sm} variant="filled">
        <Text variant="calloutStrong">Provider agreement — key points</Text>
        {PROVIDER_TERMS_SUMMARY.map((line) => (
          <View key={line} style={{ flexDirection: 'row', gap: t.spacing.sm }}>
            <Text variant="footnote" color="muted">
              •
            </Text>
            <Text variant="footnote" color="textSecondary" style={{ flex: 1 }}>
              {line}
            </Text>
          </View>
        ))}
        <Button title="Terms & privacy summary" size="sm" variant="ghost" onPress={() => router.push({ pathname: '/info/[topic]', params: { topic: 'terms' } })} style={{ alignSelf: 'flex-start' }} />
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: accepted }}
          onPress={() => setAccepted((a) => !a)}
          style={{ flexDirection: 'row', gap: t.spacing.sm, alignItems: 'center', paddingVertical: t.spacing.xs }}
        >
          <Ionicons name={accepted ? 'checkbox' : 'square-outline'} size={22} color={accepted ? t.colors.primary : t.colors.muted} />
          <Text variant="subhead" style={{ flex: 1 }}>
            I agree to the QuickServe provider agreement ({state.terms_version})
          </Text>
        </Pressable>
      </Card>
    </Screen>
  );
}
