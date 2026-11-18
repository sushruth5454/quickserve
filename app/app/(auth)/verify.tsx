import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Header, InlineAlert, OTPInput, Screen, Text, useToast } from '../../src/components/ui';
import { getMyProfile, getMyProvider, isDemoMode, sendOtp, verifyOtp } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { authErrorMessage, formatOtpCountdown } from '../../src/lib/authErrors';
import { haptics } from '../../src/lib/haptics';
import { formatPhone } from '../../src/lib/phone';
import { hasCompletedOnboarding, returningUserRole } from '../../src/lib/returningUser';
import { useTheme } from '../../src/theme';

const RESEND_SECONDS = 60;

export default function VerifyScreen() {
  const t = useTheme();
  const toast = useToast();
  const { phone, inviteToken } = useLocalSearchParams<{ phone: string; inviteToken?: string }>();
  const { setChoosingRole, setActiveRole } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);

  const submit = async (value = code) => {
    if (!phone || !/^\d{6}$/.test(value)) {
      setError('Enter the 6-digit code.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setChoosingRole(true);
      await verifyOtp(phone, value);
      haptics.success();
      const profile = await getMyProfile().catch(() => null);
      if (hasCompletedOnboarding(profile)) {
        const provider = profile.role_provider ? await getMyProvider().catch(() => null) : null;
        const role = returningUserRole(profile, !!provider);
        setActiveRole(role);
        setChoosingRole(false);
        if (inviteToken) {
          router.replace({ pathname: '/byo/[token]', params: { token: inviteToken } });
        } else {
          setTimeout(() => router.replace(role === 'provider' ? '/dashboard' : '/'), 0);
        }
        return;
      }
      router.replace(inviteToken ? { pathname: '/role', params: { inviteToken } } : '/role');
    } catch (e) {
      setChoosingRole(false);
      haptics.error();
      setError(authErrorMessage(e as Error));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!phone || left > 0) return;
    try {
      await sendOtp(phone);
      setLeft(RESEND_SECONDS);
      setCode('');
      toast({ message: 'New code sent', tone: 'success' });
    } catch (e) {
      setError(authErrorMessage(e as Error));
    }
  };

  return (
    <Screen
      header={<Header />}
      background={t.colors.surface}
      gutter={t.spacing.xxl}
      gap={t.spacing.xxl}
      footer={
        <Button title="Verify & continue" onPress={() => void submit()} loading={busy} disabled={code.length !== 6} size="lg" fullWidth />
      }
    >
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="title1" accessibilityRole="header">
          Verify your number
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6 }}>
          <Text variant="body" color="muted">
            Enter the code sent to
          </Text>
          <Text variant="bodyStrong">{formatPhone(phone)}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit phone number"
            onPress={() => router.back()}
            hitSlop={12}
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Text variant="callout" color="primaryText" style={{ fontFamily: t.fontFamily.semibold }}>
              Edit
            </Text>
          </Pressable>
        </View>
      </View>

      <OTPInput
        value={code}
        onChange={(v) => {
          setCode(v);
          if (error) setError(null);
        }}
        onComplete={(v) => void submit(v)}
        error={!!error}
        autoFocus
        accessibilityLabel="6-digit verification code"
      />

      <InlineAlert message={error} />

      <View style={{ alignItems: 'center', minHeight: 48, justifyContent: 'center' }}>
        {left > 0 ? (
          <Text variant="callout" color="muted">
            Resend code in{' '}
            <Text variant="calloutStrong" color="textSecondary" tabular>
              {formatOtpCountdown(left)}
            </Text>
          </Text>
        ) : (
          <Button title="Resend code" variant="ghost" onPress={() => void resend()} leftIcon="refresh" />
        )}
      </View>

      {isDemoMode ? <InlineAlert tone="warning" icon="flask-outline" message="Demo mode: the code is 123456." /> : null}
    </Screen>
  );
}
