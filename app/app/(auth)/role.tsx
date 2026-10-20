import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState, type ComponentProps } from 'react';
import { Pressable, View } from 'react-native';
import { Button, InlineAlert, Input, Screen, Text } from '../../src/components/ui';
import { getMyProfile, getMyProvider, updateMyProfile } from '../../src/lib/api';
import { useAuth, type ActiveRole } from '../../src/lib/auth';
import { haptics } from '../../src/lib/haptics';
import { useTheme } from '../../src/theme';

type Mc = ComponentProps<typeof MaterialCommunityIcons>['name'];

const ROLES: { role: ActiveRole; title: string; subtitle: string; icons: Mc[]; tint: string; bullets: string[] }[] = [
  {
    role: 'customer',
    title: 'I need a service',
    subtitle: 'Book verified pros near you',
    icons: ['air-conditioner', 'flash', 'pipe-wrench', 'broom'],
    tint: '#1E5EFF',
    bullets: ['Transparent itemised quotes', 'Pay only after you approve'],
  },
  {
    role: 'provider',
    title: 'I provide services',
    subtitle: 'Get jobs nearby and get paid in-app',
    icons: ['briefcase-variant', 'wallet', 'star-circle', 'map-marker-radius'],
    tint: '#12B76A',
    bullets: ['0% commission for your first 30 days', 'Weekly payouts to your bank'],
  },
];

export default function RoleScreen() {
  const t = useTheme();
  const { setChoosingRole, setActiveRole } = useAuth();
  const [name, setName] = useState('');
  const [role, setRole] = useState<ActiveRole>('customer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMyProfile()
      .then((p) => p?.full_name && setName((n) => n || p.full_name))
      .catch(() => undefined);
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
      setActiveRole(role);
      setChoosingRole(false);
      // Navigate after the auth guard re-renders with the signed-in routes enabled.
      setTimeout(() => router.replace(target), 0);
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
      contentStyle={{ paddingHorizontal: t.spacing.xxl }}
      gap={t.spacing.xl}
      footer={<Button title="Continue" onPress={() => void proceed()} loading={busy} size="lg" fullWidth rightIcon="arrow-forward" />}
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
              style={({ pressed }) => [
                {
                  borderRadius: t.radii.xl,
                  borderWidth: 2,
                  borderColor: selected ? r.tint : t.colors.border,
                  backgroundColor: selected ? r.tint + (t.dark ? '1F' : '0D') : t.colors.surface,
                  padding: t.spacing.lg,
                  gap: t.spacing.md,
                  transform: [{ scale: pressed ? 0.99 : 1 }],
                },
                selected ? t.shadows.md : null,
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row' }}>
                  {r.icons.map((ic, i) => (
                    <View
                      key={ic}
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 22,
                        marginLeft: i === 0 ? 0 : -10,
                        backgroundColor: t.dark ? t.colors.surfaceAlt : '#FFFFFF',
                        borderWidth: 2,
                        borderColor: r.tint + '33',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <MaterialCommunityIcons name={ic} size={22} color={r.tint} />
                    </View>
                  ))}
                </View>
                <Ionicons
                  name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                  size={26}
                  color={selected ? r.tint : t.colors.borderStrong}
                />
              </View>
              <View style={{ gap: 2 }}>
                <Text variant="title3">{r.title}</Text>
                <Text variant="callout" color="muted">
                  {r.subtitle}
                </Text>
              </View>
              <View style={{ gap: 6 }}>
                {r.bullets.map((b) => (
                  <View key={b} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Ionicons name="checkmark" size={16} color={r.tint} />
                    <Text variant="caption" color="textSecondary">
                      {b}
                    </Text>
                  </View>
                ))}
              </View>
            </Pressable>
          );
        })}
      </View>
      <InlineAlert message={error} />
    </Screen>
  );
}
