import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Header, InlineAlert, OTPInput, Screen, Text, useToast } from '../../components/ui';
import { getMyProfile, getMyProvider, isDemoMode, sendOtp, verifyOtp } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { authErrorMessage, formatOtpCountdown } from '../../lib/authErrors';
import { haptics } from '../../lib/haptics';
import { formatPhone } from '../../lib/phone';
import { hasCompletedOnboarding, isSafeAuthReturnTo, resolveAuthDestination, returningUserRole } from '../../lib/returningUser';
import { useTheme } from '../../theme';

const RESEND_SECONDS = 60;

function loadAuthIdentityHook() {
  try {
    return (require('../../branding/useBrandIdentity') as {
      useBrandIdentity: (context: 'auth') => { displayName: string; tagline: string | null };
    }).useBrandIdentity;
  } catch {
    return null;
  }
}

function useAuthIdentity() {
  const hook = loadAuthIdentityHook();
  return hook ? hook('auth') : { displayName: 'QuickServe', tagline: null };
}

function loadAuthUxHook() {
  try {
    return (require('../../branding/FeatureFlagsProvider') as {
      useFeature: (key: string) => boolean;
    }).useFeature;
  } catch {
    return null;
  }
}

function useAuthUx() {
  const hook = loadAuthUxHook();
  return hook ? hook('oorva_auth_ux') : false;
}

function useAuthVerifyController() {
  const t = useTheme();
  const toast = useToast();
  const { phone, inviteToken, returnTo } = useLocalSearchParams<{ phone: string; inviteToken?: string; returnTo?: string }>();
  const { setChoosingRole, setActiveRole } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(RESEND_SECONDS);
  const [otpVerified, setOtpVerified] = useState(false);
  const otpVerifiedRef = useRef(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (left <= 0 || otpVerified) return;
    const id = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [left, otpVerified]);

  const submit = async (value = code) => {
    let verified = otpVerifiedRef.current || otpVerified;
    if (!phone || (!verified && !/^\d{6}$/.test(value))) {
      setError('Enter the 6-digit code.');
      return;
    }
    if (busyRef.current) return;

    busyRef.current = true;
    let lookup: 'profile' | 'provider' | null = null;
    setBusy(true);
    setError(null);
    try {
      if (!verified) {
        setChoosingRole(true);
        await verifyOtp(phone, value);
        verified = true;
        otpVerifiedRef.current = true;
        setOtpVerified(true);
        haptics.success();
      }

      lookup = 'profile';
      const profile = await getMyProfile();
      lookup = null;
      if (profile && hasCompletedOnboarding(profile)) {
        let provider = null;
        if (profile.role_provider) {
          lookup = 'provider';
          provider = await getMyProvider();
          lookup = null;
        }
        const role = returningUserRole(profile, !!provider);
        const destination = resolveAuthDestination({
          inviteToken,
          returnTo,
          roleDefault: role === 'provider' ? '/dashboard' : '/',
        });
        const invited = typeof destination !== 'string';
        setActiveRole(invited ? 'customer' : role);
        setChoosingRole(false);
        if (invited) router.replace(destination);
        else setTimeout(() => router.replace(destination), 0);
        return;
      }

      const safePath = isSafeAuthReturnTo(returnTo) ? returnTo : undefined;
      const safeInvite = typeof inviteToken === 'string' && inviteToken.length > 0 && inviteToken === inviteToken.trim()
        ? inviteToken
        : undefined;
      router.replace(
        safeInvite || safePath
          ? {
              pathname: '/role',
              params: {
                ...(safeInvite ? { inviteToken: safeInvite } : {}),
                ...(safePath ? { returnTo: safePath } : {}),
              },
            }
          : '/role',
      );
    } catch (e) {
      if (!verified) {
        setChoosingRole(false);
        haptics.error();
        setError(authErrorMessage(e as Error));
      } else {
        setError(
          lookup === 'provider'
            ? 'Unable to load your provider profile. Retry to continue.'
            : 'Unable to load your profile. Retry to continue.',
        );
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!phone || left > 0 || otpVerified) return;
    try {
      await sendOtp(phone);
      setLeft(RESEND_SECONDS);
      setCode('');
      toast({ message: 'New code sent', tone: 'success' });
    } catch (e) {
      setError(authErrorMessage(e as Error));
    }
  };

  return { t, phone, code, setCode, busy, error, setError, left, otpVerified, submit, resend };
}

export default function AuthVerifyScreen() {
  const { t, phone, code, setCode, busy, error, setError, left, otpVerified, submit, resend } = useAuthVerifyController();
  const identity = useAuthIdentity();
  const authUx = useAuthUx();

  return (
    <Screen
      header={<Header />}
      background={t.colors.surface}
      gutter={t.spacing.xxl}
      gap={t.spacing.xxl}
      footer={
        <Button
          title={otpVerified ? 'Retry' : 'Verify & continue'}
          onPress={() => void submit()}
          loading={busy}
          disabled={busy || (!otpVerified && code.length !== 6)}
          size="lg"
          fullWidth
        />
      }
    >
      <View style={{ gap: t.spacing.sm }}>
        {authUx ? (
          <View testID="o13c-auth-ux" style={{ gap: t.spacing.xs }}>
            <Text variant="overline">{identity.displayName}</Text>
            {identity.tagline ? <Text variant="footnote" color="muted">{identity.tagline}</Text> : null}
          </View>
        ) : null}
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
            <Text variant="calloutStrong" color="primaryText">
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

      {!otpVerified ? (
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
      ) : null}

      {isDemoMode ? <InlineAlert tone="warning" icon="flask-outline" message="Demo mode: the code is 123456." /> : null}
    </Screen>
  );
}
