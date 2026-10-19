import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { ErrorText, Field, Screen } from '../../src/components/Screen';
import { getMyProvider, updateMyProfile } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { colors, font, radius, spacing } from '../../src/lib/theme';

export default function RoleScreen() {
  const { setChoosingRole } = useAuth();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async (role: 'customer' | 'provider') => {
    setBusy(true);
    setError(null);
    try {
      await updateMyProfile({
        ...(name.trim() ? { full_name: name.trim() } : {}),
        role_customer: true,
        ...(role === 'provider' ? { role_provider: true } : {}),
      });
      const target = role === 'provider' ? ((await getMyProvider()) ? '/dashboard' : '/onboarding') : '/';
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
    <Screen>
      <Text style={font.title}>How will you use QuickServe?</Text>
      <Field label="Your name" placeholder="Priya Sharma" value={name} onChangeText={setName} autoComplete="name" />
      <RoleCard
        title="I need a service"
        subtitle="Book verified AC techs, electricians, plumbers, cleaners and more."
        onPress={() => choose('customer')}
        disabled={busy}
      />
      <RoleCard
        title="I provide services"
        subtitle="Get jobs nearby, send itemized quotes and get paid in the app."
        onPress={() => choose('provider')}
        disabled={busy}
      />
      <ErrorText message={error} />
      <Text style={font.caption}>You can add a provider profile later from the home screen.</Text>
    </Screen>
  );
}

function RoleCard(props: { title: string; subtitle: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      disabled={props.disabled}
      style={({ pressed }) => [styles.card, pressed && { borderColor: colors.primary }]}
    >
      <Text style={font.heading}>{props.title}</Text>
      <Text style={font.caption}>{props.subtitle}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.lg,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.xs,
    minHeight: 88,
  },
});
