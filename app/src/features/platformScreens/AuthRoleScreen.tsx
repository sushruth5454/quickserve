import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, InlineAlert, Input, Screen, Text } from '../../components/ui';
import { getCommissionTerms, getMyProfile, getMyProvider, updateMyProfile } from '../../lib/api';
import { useAuth, type ActiveRole } from '../../lib/auth';
import { haptics } from '../../lib/haptics';
import { roleProfilePatch } from '../../lib/roleSelection';
import { resolveAuthDestination } from '../../lib/returningUser';
import { useBrandIdentity } from '../../branding/useBrandIdentity';
import { useFeature } from '../../branding/FeatureFlagsProvider';
import { useTheme } from '../../theme';

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

function useAuthRoleController() {
  const t = useTheme();
  const { inviteToken, returnTo } = useLocalSearchParams<{ inviteToken?: string; returnTo?: string }>();
  const { setChoosingRole, setActiveRole } = useAuth();
  const [name, setName] = useState('');
  const [role, setRole] = useState<ActiveRole>('customer');
  const [commissionBullet, setCommissionBullet] = useState('Low commission on in-app jobs');
  const [profileStatus, setProfileStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    setProfileStatus('loading');
    setError(null);
    try {
      const profile = await getMyProfile();
      if (profile?.full_name) setName((current) => current || profile.full_name);
      if (profile?.role_provider) setRole('provider');
      setProfileStatus('ready');
    } catch {
      setProfileStatus('error');
      setError('Unable to load your profile. Retry before continuing.');
    }
  }, []);

  useEffect(() => {
    void loadProfile();
    getCommissionTerms()
      .then((terms) => setCommissionBullet(`0% commission for your first ${terms.founding_days} days`))
      .catch(() => setCommissionBullet('Low commission on in-app jobs'));
  }, [loadProfile]);

  const proceed = async () => {
    if (profileStatus !== 'ready') return;
    setBusy(true);
    setError(null);
    try {
      let target = '/';
      if (role === 'provider') {
        try {
          const provider = await getMyProvider();
          target = provider ? '/dashboard' : '/onboarding';
        } catch {
          setError('Unable to load your provider profile. Retry to continue.');
          return;
        }
      }

      const profilePatch = roleProfilePatch(name);
      if (profilePatch) await updateMyProfile(profilePatch);
      const destination = resolveAuthDestination({ inviteToken, returnTo, roleDefault: target });
      setActiveRole(typeof destination === 'string' ? role : 'customer');
      setChoosingRole(false);
      setTimeout(() => router.replace(destination), 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return {
    t,
    name,
    setName,
    role,
    setRole,
    commissionBullet,
    profileStatus,
    busy,
    error,
    loadProfile,
    proceed,
  };
}

export default function AuthRoleScreen() {
  const { t, name, setName, role, setRole, commissionBullet, profileStatus, busy, error, loadProfile, proceed } =
    useAuthRoleController();
  const identity = useBrandIdentity('auth');
  const authUx = useFeature('oorva_auth_ux');

  return (
    <Screen
      safeTop
      background={t.colors.surface}
      gutter={t.spacing.xxl}
      gap={t.spacing.xxl}
      footer={
        <Button
          title={profileStatus === 'error' || error ? 'Retry' : 'Continue'}
          onPress={() => void (profileStatus === 'error' ? loadProfile() : proceed())}
          loading={busy || profileStatus === 'loading'}
          disabled={busy || profileStatus === 'loading'}
          size="lg"
          fullWidth
        />
      }
    >
      <View style={{ gap: t.spacing.sm, marginTop: t.spacing.lg }}>
        {authUx ? (
          <View testID="o13c-auth-ux" style={{ gap: t.spacing.xs }}>
            <Text variant="overline">{identity.displayName}</Text>
            {identity.tagline ? <Text variant="footnote" color="muted">{identity.tagline}</Text> : null}
          </View>
        ) : null}
        <Text variant="title1" accessibilityRole="header">
          Welcome to {identity.displayName}
        </Text>
        <Text variant="body" color="muted">
          Tell us your name and how you'll use the app. You can switch any time from the Me tab.
        </Text>
      </View>
      <Input label="Your name" placeholder="Priya Sharma" value={name} onChangeText={setName} autoComplete="name" leftIcon="person-outline" />
      <View accessibilityRole="radiogroup" style={{ gap: t.spacing.md }}>
        <Text variant="subhead" color="textSecondary">
          How will you use {identity.displayName}?
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
