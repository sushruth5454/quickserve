import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, InlineAlert, Input, Screen, Text } from '../../src/components/ui';
import { isDemoMode, sendOtp } from '../../src/lib/api';
import { useTheme } from '../../src/theme';
import { normalizeIndianPhone } from '../../src/lib/phone';

function formatLocal(digits: string) {
  return digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
}

export default function LoginScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [digits, setDigits] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const e164 = normalizeIndianPhone(digits);
  const fieldError =
    touched && digits.length > 0 && !e164
      ? digits.length < 10
        ? 'Enter all 10 digits of your mobile number.'
        : 'Indian mobile numbers start with 6, 7, 8 or 9.'
      : null;

  const submit = async () => {
    setTouched(true);
    if (!e164) {
      setError(digits.length === 0 ? 'Enter your mobile number to continue.' : null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendOtp(e164);
      router.push({ pathname: '/verify', params: { phone: e164 } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const link = (topic: 'terms' | 'privacy') => router.push({ pathname: '/info/[topic]', params: { topic } });

  return (
    <Screen padded={false} gap={0} background={t.colors.surface}>
      <LinearGradient
        colors={[t.colors.heroFrom, t.colors.heroTo]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          minHeight: insets.top + 184,
          paddingTop: insets.top + t.spacing.xxl,
          paddingBottom: t.spacing.huge,
          paddingHorizontal: t.spacing.xxl,
          gap: t.spacing.lg,
          justifyContent: 'flex-end',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              backgroundColor: '#FFFFFF',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MaterialCommunityIcons name="hammer-wrench" size={26} color="#1E5EFF" />
          </View>
          <Text variant="title1" style={{ color: '#FFFFFF' }}>
            QuickServe
          </Text>
        </View>
        <Text variant="body" style={{ color: 'rgba(255,255,255,0.92)' }}>
          Trusted local pros, booked in 60 seconds.
        </Text>
      </LinearGradient>

      <View
        style={{
          marginTop: -t.spacing.xl,
          borderTopLeftRadius: t.radii.xl,
          borderTopRightRadius: t.radii.xl,
          backgroundColor: t.colors.surface,
          paddingHorizontal: t.spacing.xxl,
          paddingTop: t.spacing.xxl + 4,
          gap: t.spacing.xl,
        }}
      >
        <View style={{ gap: 6 }}>
          <Text variant="title2" accessibilityRole="header">
            Log in or sign up
          </Text>
          <Text variant="callout" color="muted">
            We'll text a 6-digit code to verify your number. No passwords.
          </Text>
        </View>

        <Input
          label="Mobile number"
          prefix="+91"
          size="lg"
          placeholder="98765 43210"
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          value={formatLocal(digits)}
          onChangeText={(v) => {
            const d = v.replace(/\D/g, '');
            setDigits((d.startsWith('91') && d.length > 10 ? d.slice(2) : d).slice(0, 10));
            setError(null);
          }}
          onBlur={() => setTouched(true)}
          onSubmitEditing={() => void submit()}
          returnKeyType="done"
          maxLength={11}
          error={fieldError}
          right={e164 ? <Ionicons name="checkmark-circle" size={22} color={t.colors.success} /> : null}
          accessibilityLabel="Mobile number, India plus 91"
        />
        <InlineAlert message={error} />
        <Button title="Send OTP" onPress={() => void submit()} loading={busy} size="lg" fullWidth />

        {isDemoMode ? (
          <InlineAlert tone="warning" icon="flask-outline" title="Demo mode" message="Use any valid Indian mobile number. The code is 123456." />
        ) : null}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 6, rowGap: 4 }}>
          {['KYC-verified pros', 'Quote before work', 'Secure payments'].map((x, i) => (
            <View key={x} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {i > 0 ? <Text variant="footnote" color="muted">·</Text> : null}
              <Text variant="footnote" color="textSecondary">
                {x}
              </Text>
            </View>
          ))}
        </View>

        <Text variant="caption" color="muted" align="center" style={{ marginTop: t.spacing.sm, marginBottom: t.spacing.lg }}>
          By continuing you agree to our{' '}
          <Text variant="caption" color="primaryText" style={{ textDecorationLine: 'underline' }} onPress={() => link('terms')} accessibilityRole="link">
            Terms of Service
          </Text>{' '}
          and{' '}
          <Text variant="caption" color="primaryText" style={{ textDecorationLine: 'underline' }} onPress={() => link('privacy')} accessibilityRole="link">
            Privacy Policy
          </Text>
          .
        </Text>
      </View>
    </Screen>
  );
}
