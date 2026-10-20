import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../lib/auth';
import { getMyProfile, getMyProvider, isDemoMode, requestAccountDeletion, signOut } from '../lib/api';
import { formatPhone } from '../lib/phone';
import type { Profile, Provider } from '../lib/types';
import { useTheme } from '../theme';
import { Avatar, Badge, Card, Divider, Header, ListItem, Screen, Skeleton, Text, useConfirm, useToast } from './ui';

export function AccountScreen({ mode }: { mode: 'customer' | 'provider' }) {
  const t = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const { session, setActiveRole } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [provider, setProvider] = useState<Provider | null | undefined>(undefined);

  useFocusEffect(
    useCallback(() => {
      getMyProfile().then(setProfile).catch(() => undefined);
      getMyProvider().then(setProvider).catch(() => setProvider(null));
    }, []),
  );

  const name = profile?.full_name || 'QuickServe user';

  const switchRole = () => {
    if (mode === 'customer') {
      setActiveRole('provider');
      router.replace(provider ? '/dashboard' : '/onboarding');
    } else {
      setActiveRole('customer');
      router.replace('/');
    }
  };

  const logout = async () => {
    const ok = await confirm({ title: 'Log out?', message: 'You can log back in with your mobile number.', confirmLabel: 'Log out', icon: 'log-out-outline' });
    if (ok) await signOut();
  };

  const deleteAccount = async () => {
    const ok = await confirm({
      title: 'Delete your account?',
      message:
        'We will permanently delete your profile, addresses and chat history. Booking and payment records we must keep by law are anonymised. Open bookings must be finished or cancelled first.',
      confirmLabel: 'Request deletion',
      destructive: true,
      icon: 'trash-outline',
    });
    if (!ok) return;
    try {
      await requestAccountDeletion();
      toast({ message: 'Account deletion requested.', tone: 'success' });
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    }
  };

  const help = () =>
    Linking.openURL('mailto:support@quickserve.app?subject=Help%20with%20QuickServe').catch(() =>
      toast({ message: 'Email us at support@quickserve.app', tone: 'default' }),
    );

  return (
    <Screen inTabs header={<Header title="Me" large back={false} />}>
      <Card gap={t.spacing.md}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.lg }}>
          <Avatar name={name} uri={profile?.avatar_url} size={64} verified={mode === 'provider' && provider?.kyc_status === 'verified'} />
          <View style={{ flex: 1, gap: 4 }}>
            {profile ? <Text variant="title2" numberOfLines={1}>{name}</Text> : <Skeleton width={160} height={22} />}
            <Text variant="callout" color="muted">
              {formatPhone(session?.phone) || 'Phone verified'}
            </Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              <Badge label={mode === 'provider' ? 'Provider' : 'Customer'} tone="primary" />
              {isDemoMode ? <Badge label="Demo mode" tone="warning" icon="sparkles" /> : null}
            </View>
          </View>
        </View>
      </Card>

      <Group title={mode === 'provider' ? 'Work' : 'Account'}>
        {mode === 'provider' ? (
          <>
            <ListItem icon="id-card-outline" title="Provider profile" subtitle="Bio, skills, fees and payout details" chevron onPress={() => router.push('/onboarding')} />
            <Divider inset={72} />
            <ListItem icon="list-outline" title="Job history" subtitle="All requests and completed jobs" chevron onPress={() => router.push('/jobs')} />
            <Divider inset={72} />
          </>
        ) : (
          <>
            <ListItem icon="calendar-outline" title="My bookings" chevron onPress={() => router.navigate('/bookings')} />
            <Divider inset={72} />
          </>
        )}
        <ListItem
          icon="swap-horizontal"
          iconTint={t.colors.success}
          title={mode === 'customer' ? 'Switch to provider mode' : 'Switch to customer mode'}
          subtitle={
            mode === 'customer'
              ? provider
                ? 'Manage jobs and earnings'
                : 'Offer your services on QuickServe'
              : 'Book services for your home'
          }
          chevron
          onPress={switchRole}
        />
      </Group>

      <Group title="Support">
        <ListItem icon="help-buoy-outline" iconTint={t.colors.info} title="Help & support" subtitle="support@quickserve.app" chevron onPress={() => void help()} />
        <Divider inset={72} />
        <ListItem
          icon="shield-checkmark-outline"
          iconTint={t.colors.success}
          title="Safety & guarantee"
          subtitle="Verified pros, OTP-protected visits, money held until done"
        />
      </Group>

      <Group title="Session">
        <ListItem icon="log-out-outline" iconTint={t.colors.muted} title="Log out" onPress={() => void logout()} />
        <Divider inset={72} />
        <ListItem icon="trash-outline" title="Delete account" subtitle="Permanently delete your account and data" destructive onPress={() => void deleteAccount()} />
      </Group>

      <Text variant="caption" color="subtle" align="center">
        QuickServe v{Constants.expoConfig?.version ?? '1.0.0'}
        {isDemoMode ? ' · demo data' : ''}
      </Text>
    </Screen>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.sm }}>
      <Text variant="micro" color="muted" uppercase style={{ paddingHorizontal: t.spacing.xs }}>
        {title}
      </Text>
      <Card padding={0} gap={0} style={{ overflow: 'hidden' }}>
        {children}
      </Card>
    </View>
  );
}
