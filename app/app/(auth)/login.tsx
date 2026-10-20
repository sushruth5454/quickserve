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

const TRUST: { icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
  { icon: 'shield-checkmark', label: 'KYC-verified pros' },
  { icon: 'receipt', label: 'Approve the quote first' },
  { icon: 'lock-closed', label: 'Pay securely in-app' },
];

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

  return (
    <Screen padded={false} gap={0} background={t.colors.surface}>
      <LinearGradient
        colors={[t.colors.heroFrom, t.colors.heroTo]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          paddingTop: insets.top + t.spacing.huge,
          paddingBottom: t.spacing.huge + t.spacing.xl,
          paddingHorizontal: t.spacing.xxl,
          gap: t.spacing.lg,
          overflow: 'hidden',
        }}
      >
        <MaterialCommunityIcons
          name="tools"
          size={180}
          color="rgba(255,255,255,0.08)"
          style={{ position: 'absolute', right: -30, top: insets.top + 10, transform: [{ rotate: '-12deg' }] }}
        />
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 20,
            backgroundColor: 'rgba(255,255,255,0.18)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.35)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MaterialCommunityIcons name="hammer-wrench" size={34} color="#FFFFFF" />
        </View>
        <View style={{ gap: 6 }}>
          <Text variant="display" style={{ color: '#FFFFFF' }}>
            QuickServe
          </Text>
          <Text variant="body" style={{ color: 'rgba(255,255,255,0.88)' }}>
            Trusted local pros, booked in 60 seconds.
          </Text>
        </View>
      </LinearGradient>

      <View
        style={{
          marginTop: -t.spacing.xxl,
          borderTopLeftRadius: t.radii.xxl,
          borderTopRightRadius: t.radii.xxl,
          backgroundColor: t.colors.surface,
          paddingHorizontal: t.spacing.xxl,
          paddingTop: t.spacing.xxl + 4,
          gap: t.spacing.lg,
        }}
      >
        <View style={{ gap: 4 }}>
          <Text variant="title2" accessibilityRole="header">
            Log in or sign up
          </Text>
          <Text variant="callout" color="muted">
            We'll text a 6-digit code to verify your number. No passwords.
          </Text>
        </View>

        {isDemoMode ? (
          <InlineAlert
            tone="info"
            icon="sparkles"
            title="Demo mode"
            message="Use any valid Indian mobile number. The verification code is 123456."
          />
        ) : null}

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
        <Button title="Send OTP" onPress={() => void submit()} loading={busy} size="lg" fullWidth rightIcon="arrow-forward" />

        <View style={{ gap: t.spacing.md, marginTop: t.spacing.sm }}>
          {TRUST.map((x) => (
            <View key={x.label} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  backgroundColor: t.colors.successSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name={x.icon} size={16} color={t.colors.success} />
              </View>
              <Text variant="callout" color="textSecondary">
                {x.label}
              </Text>
            </View>
          ))}
        </View>

        <Text variant="caption" color="muted" align="center" style={{ marginTop: t.spacing.lg }}>
          By continuing you agree to our Terms of Service and Privacy Policy.
        </Text>
      </View>
    </Screen>
  );
}
