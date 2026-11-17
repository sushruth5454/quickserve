import Constants from 'expo-constants';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../lib/auth';
import { getMyCoinBalance, getMyProfile, getMyProvider, isDemoMode, signOut } from '../lib/api';
import { amIAdmin } from '../lib/adminApi';
import { formatPhone } from '../lib/phone';
import { formatINR } from '../lib/money';
import type { Profile, Provider } from '../lib/types';
import { useTheme } from '../theme';
import { ProviderMeSections } from './ProviderMeSections';
import { Avatar, Card, Divider, Header, LIST_INSET, ListItem, Screen, Skeleton, Text, useConfirm, useToast } from './ui';

export function AccountScreen({ mode }: { mode: 'customer' | 'provider' }) {
  const t = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const { session, setActiveRole } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [provider, setProvider] = useState<Provider | null | undefined>(undefined);
  const [coinBalance, setCoinBalance] = useState(0);
  const [admin, setAdmin] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getMyProfile().then(setProfile).catch(() => undefined);
      getMyProvider().then(setProvider).catch(() => setProvider(null));
      amIAdmin().then(setAdmin).catch(() => setAdmin(false));
      if (mode === 'customer') getMyCoinBalance().then(setCoinBalance).catch(() => setCoinBalance(0));
    }, [mode]),
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

  const help = () => router.push('/support');

  const soon = (what: string) => toast({ message: `${what} is coming soon.`, tone: 'default' });
  const notifications = () => Linking.openSettings().catch(() => toast({ message: 'Manage notifications in your phone settings.' }));
  const openInfo = (topic: 'safety' | 'terms' | 'privacy') => router.push({ pathname: '/info/[topic]', params: { topic } });

  return (
    <Screen inTabs header={<Header title="Me" large back={false} />} gap={t.spacing.section}>
      <Card padding={0} gap={0}>
        <Pressable
          accessibilityRole={mode === 'provider' ? 'button' : undefined}
          accessibilityLabel={`${name}, ${formatPhone(session?.phone) || 'phone verified'}`}
          disabled={mode !== 'provider'}
          onPress={() => router.push('/onboarding')}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: t.spacing.lg,
            padding: t.spacing.lg,
            borderRadius: t.radii.lg,
            backgroundColor: pressed ? t.colors.surfaceAlt : 'transparent',
          })}
        >
          <Avatar name={name} uri={profile?.avatar_url} size={56} verified={mode === 'provider' && provider?.kyc_status === 'verified'} />
          <View style={{ flex: 1, gap: 2 }}>
            {profile ? (
              <Text variant="title2" numberOfLines={1}>
                {name}
              </Text>
            ) : (
              <Skeleton width={160} height={22} />
            )}
            <Text variant="callout" color="muted" numberOfLines={1}>
              {formatPhone(session?.phone) || 'Phone verified'}
            </Text>
          </View>
          {mode === 'provider' ? <Ionicons name="chevron-forward" size={18} color={t.colors.subtle} /> : null}
        </Pressable>
      </Card>

      {mode === 'provider' ? (
        <Group title="Work">
          <ListItem icon="id-card-outline" title="Provider profile" subtitle="Photo, services, area, hours, work photos and payouts" chevron onPress={() => router.push('/provider-profile')} />
          <Divider inset={LIST_INSET} />
          <ListItem icon="people-outline" title="Business tools" subtitle="Create a protected booking for an existing client" chevron onPress={() => router.push('/business-tools')} />
          <Divider inset={LIST_INSET} />
          <ListItem icon="swap-horizontal" title="Switch to customer mode" subtitle="Book services for your home" chevron onPress={switchRole} />
        </Group>
      ) : (
        <Group title="Mode">
          <ListItem
            icon="swap-horizontal"
            title="Switch to provider mode"
            subtitle={provider ? 'Manage jobs and earnings' : 'Offer your services on QuickServe'}
            chevron
            onPress={switchRole}
          />
        </Group>
      )}

      {mode === 'provider' && provider ? <ProviderMeSections provider={provider} /> : null}

      {admin ? (
        <Group title="Administration">
          <ListItem
            icon="settings-outline"
            title="Admin portal"
            subtitle="Trends, services, people, bookings and support"
            chevron
            onPress={() => router.push({ pathname: '/admin', params: { returnTo: mode === 'provider' ? 'pro-account' : 'account' } })}
          />
        </Group>
      ) : null}

      <Group title="Account">
        {mode === 'customer' ? (
          <>
            <ListItem
              icon="sparkles-outline"
              title="Seva Coins"
              subtitle="1 coin = ₹1 · valid for 6 months"
              value={formatINR(coinBalance)}
              chevron
              onPress={() => router.push('/coins')}
            />
            <Divider inset={LIST_INSET} />
            <ListItem icon="location-outline" title="Saved addresses" subtitle="Home and other places you book for" chevron onPress={() => soon('Saved addresses')} />
            <Divider inset={LIST_INSET} />
            <ListItem icon="card-outline" title="Payment methods" subtitle="UPI, cards and netbanking at checkout" chevron onPress={() => soon('Saved payment methods')} />
            <Divider inset={LIST_INSET} />
          </>
        ) : null}
        <ListItem icon="notifications-outline" title="Notifications" chevron onPress={() => void notifications()} />
        <Divider inset={LIST_INSET} />
        <ListItem icon="language-outline" title="Language" value="English" chevron onPress={() => soon('Hindi and Telugu')} />
        <Divider inset={LIST_INSET} />
        <ListItem icon="lock-closed-outline" title="Privacy & data" subtitle="Download or delete your data" chevron onPress={() => openInfo('privacy')} />
      </Group>

      <Group title="Support">
        <ListItem icon="help-buoy-outline" title="Help & support" subtitle="Message QuickServe support in the app" chevron onPress={help} />
        <Divider inset={LIST_INSET} />
        <ListItem icon="shield-checkmark-outline" title="Safety & guarantee" chevron onPress={() => openInfo('safety')} />
        <Divider inset={LIST_INSET} />
        <ListItem icon="document-text-outline" title="Terms & privacy policy" chevron onPress={() => openInfo('terms')} />
      </Group>

      <Card padding={0} gap={0} style={{ overflow: 'hidden' }}>
        <ListItem icon="log-out-outline" title="Log out" onPress={() => void logout()} />
      </Card>

      <Text variant="caption" color="muted" align="center">
        QuickServe {Constants.expoConfig?.version ?? '1.0.0'}
        {isDemoMode ? ' · Demo mode' : ''}
      </Text>
    </Screen>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.sm }}>
      <Text variant="overline" color="muted" style={{ paddingHorizontal: t.spacing.lg }} accessibilityRole="header">
        {title}
      </Text>
      <Card padding={0} gap={0} style={{ overflow: 'hidden' }}>
        {children}
      </Card>
    </View>
  );
}
