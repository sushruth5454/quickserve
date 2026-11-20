import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, InlineAlert, Input, Screen, Text } from '../../src/components/ui';
import { getCommissionTerms, getMyProfile, getMyProvider, updateMyProfile } from '../../src/lib/api';
import { useAuth, type ActiveRole } from '../../src/lib/auth';
import { safeReturnTo } from '../../src/lib/authGate';
import { haptics } from '../../src/lib/haptics';
import { useTheme } from '../../src/theme';

const ROLES: { role: ActiveRole; title: string; subtitle: string; icon: keyof typeof Ionicons.glyphMap; bullets: string[] }[] = [
  {
    role: 'customer',
    title: 'I need a service',
    subtitle: 'Book verified pros near you',
    icon: 'home-outline',
    bullets: ['Transparent itemised quotes', 'Pay only after you approve'],
  },
  {
    role: 'provider',
    title: 'I provide services',
    subtitle: 'Get jobs nearby and get paid in-app',
    icon: 'briefcase-outline',
    bullets: ['Weekly payouts to your bank'],
  },
];

export default function RoleScreen() {
  const t = useTheme();
  const { inviteToken, returnTo } = useLocalSearchParams<{ inviteToken?: string; returnTo?: string }>();
  const safePath = safeReturnTo(returnTo) ? returnTo : undefined;
  const { setChoosingRole, setActiveRole } = useAuth();
  const [name, setName] = useState('');
  const [role, setRole] = useState<ActiveRole>('customer');
  const [commissionBullet, setCommissionBullet] = useState('Low commission on in-app jobs');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMyProfile()
      .then((p) => {
        if (p?.full_name) setName((n) => n || p.full_name);
        if (p?.role_provider) setRole('provider');
      })
      .catch(() => undefined);
    getCommissionTerms()
      .then((terms) => setCommissionBullet(`0% commission for your first ${terms.founding_days} days`))
      .catch(() => setCommissionBullet('Low commission on in-app jobs'));
  }, []);

  const proceed = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateMyProfile({
        ...(name.trim() ? { full_name: name.trim() } : {}),
        role_customer: true,
        ...(role === 'provider' ? { role_provider: true } : {}),
      });
      const target = role === 'provider' ? ((await getMyProvider()) ? '/dashboard' : '/onboarding') : '/';
      setActiveRole(inviteToken ? 'customer' : role);
      setChoosingRole(false);
      // Navigate after the auth guard re-renders with the signed-in routes enabled.
      setTimeout(
        () => inviteToken
          ? router.replace({ pathname: '/byo/[token]', params: { token: inviteToken } })
          : router.replace(role === 'customer' && safePath ? safePath : target),
        0,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      safeTop
      background={t.colors.surface}
      gutter={t.spacing.xxl}
      gap={t.spacing.xxl}
      footer={<Button title="Continue" onPress={() => void proceed()} loading={busy} size="lg" fullWidth />}
    >
      <View style={{ gap: t.spacing.sm, marginTop: t.spacing.lg }}>
        <Text variant="title1" accessibilityRole="header">
          Welcome to QuickServe
        </Text>
        <Text variant="body" color="muted">
          Tell us your name and how you'll use the app. You can switch any time from the Me tab.
        </Text>
      </View>
      <Input label="Your name" placeholder="Priya Sharma" value={name} onChangeText={setName} autoComplete="name" leftIcon="person-outline" />
      <View accessibilityRole="radiogroup" style={{ gap: t.spacing.md }}>
        <Text variant="subhead" color="textSecondary">
          How will you use QuickServe?
        </Text>
        {ROLES.map((r) => {
          const selected = role === r.role;
          return (
            <Pressable
              key={r.role}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={`${r.title}. ${r.subtitle}`}
              onPress={() => {
                haptics.select();
                setRole(r.role);
              }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: t.spacing.md,
                borderRadius: t.radii.lg,
                borderWidth: selected ? 2 : 1,
                borderColor: selected ? t.colors.primary : t.colors.borderStrong,
                backgroundColor: selected ? t.colors.primarySoft : pressed ? t.colors.surfaceAlt : t.colors.surface,
                padding: selected ? t.spacing.lg - 1 : t.spacing.lg,
              })}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: t.radii.md,
                  backgroundColor: selected ? t.colors.surface : t.colors.surfaceAlt,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name={r.icon} size={20} color={selected ? t.colors.primaryText : t.colors.textSecondary} />
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <View style={{ gap: 2 }}>
                  <Text variant="title3">{r.title}</Text>
                  <Text variant="footnote" color="muted">
                    {r.subtitle}
                  </Text>
                </View>
                {(r.role === 'provider' ? [commissionBullet, ...r.bullets] : r.bullets).map((b) => (
                  <View key={b} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name="checkmark" size={14} color={t.colors.muted} />
                    <Text variant="footnote" color="textSecondary">
                      {b}
                    </Text>
                  </View>
                ))}
              </View>
              <Radio selected={selected} />
            </Pressable>
          );
        })}
      </View>
      <InlineAlert message={error} />
    </Screen>
  );
}

function Radio({ selected }: { selected: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: selected ? 6 : 1.5,
        borderColor: selected ? t.colors.primary : t.colors.outline,
        backgroundColor: t.colors.surface,
        marginTop: 2,
      }}
    />
  );
}
