import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, InlineAlert, Input, Screen, Text } from '../../components/ui';
import { useBrandIdentity } from '../../branding/useBrandIdentity';
import { useFeature } from '../../branding/FeatureFlagsProvider';
import { isDemoMode, sendOtp } from '../../lib/api';
import { authErrorMessage } from '../../lib/authErrors';
import { useT } from '../../i18n';
import { safeReturnTo } from '../../lib/authGate';
import { normalizeIndianPhone } from '../../lib/phone';
import { useTheme } from '../../theme';

function formatLocal(digits: string) {
  return digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
}

function useAuthLoginController() {
  const t = useTheme();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const { inviteToken, returnTo } = useLocalSearchParams<{ inviteToken?: string; returnTo?: string }>();
  const safePath = safeReturnTo(returnTo) ? returnTo : undefined;
  const [digits, setDigits] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const e164 = normalizeIndianPhone(digits);
  const fieldError =
    touched && digits.length > 0 && !e164
      ? digits.length < 10
        ? tr('login.error.mobileDigits')
        : tr('login.error.mobilePrefix')
      : null;

  const submit = async () => {
    setTouched(true);
    if (!e164) {
      setError(digits.length === 0 ? tr('login.error.mobileRequired') : null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendOtp(e164);
      router.push({
        pathname: '/verify',
        params: {
          phone: e164,
          ...(inviteToken ? { inviteToken } : {}),
          ...(safePath ? { returnTo: safePath } : {}),
        },
      });
    } catch (e) {
      setError(authErrorMessage(e as Error));
    } finally {
      setBusy(false);
    }
  };

  return { t, tr, insets, digits, setDigits, setTouched, busy, error, setError, e164, fieldError, submit };
}

export default function AuthLoginScreen() {
  const { t, tr, insets, digits, setDigits, setTouched, busy, error, setError, e164, fieldError, submit } =
    useAuthLoginController();
  const identity = useBrandIdentity('auth');
  const authUx = useFeature('oorva_auth_ux');

  const link = (topic: 'terms' | 'privacy' | 'help') => router.push({ pathname: '/info/[topic]', params: { topic } });
  const legalText = tr('login.legal.template', { terms: '__TERMS_LINK__', privacy: '__PRIVACY_LINK__' });
  const [legalBeforeTerms, legalAfterTerms = ''] = legalText.split('__TERMS_LINK__');
  const [legalBetweenLinks, legalAfterPrivacy = ''] = legalAfterTerms.split('__PRIVACY_LINK__');

  return (
    <Screen padded={false} gap={0} background={t.colors.surface}>
      <LinearGradient
        colors={[t.colors.heroFrom, t.colors.heroTo]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          minHeight: insets.top + (authUx ? 220 : 184),
          paddingTop: insets.top + t.spacing.xxl,
          paddingBottom: t.spacing.huge,
          paddingHorizontal: t.spacing.xxl,
          gap: t.spacing.lg,
          justifyContent: 'flex-end',
        }}
      >
        {authUx ? (
          <View testID="o13c-auth-ux" style={{ gap: t.spacing.md }}>
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
                {identity.displayName}
              </Text>
            </View>
            <Text variant="title2" accessibilityRole="header" style={{ color: '#FFFFFF' }}>
              {tr('login.title')}
            </Text>
            <Text variant="body" style={{ color: 'rgba(255,255,255,0.92)' }}>
              {identity.tagline ?? tr('login.tagline')}
            </Text>
          </View>
        ) : (
          <>
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
                {identity.displayName}
              </Text>
            </View>
            <Text variant="body" style={{ color: 'rgba(255,255,255,0.92)' }}>
              {tr('login.tagline')}
            </Text>
          </>
        )}
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
        {authUx ? (
          <Text variant="callout" color="muted">
            {tr('login.subtitle')}
          </Text>
        ) : (
          <View style={{ gap: 6 }}>
            <Text variant="title2" accessibilityRole="header">
              {tr('login.title')}
            </Text>
            <Text variant="callout" color="muted">
              {tr('login.subtitle')}
            </Text>
          </View>
        )}

        <Input
          label={tr('login.phone.label')}
          prefix="+91"
          size="lg"
          placeholder={tr('login.phone.placeholder')}
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
          accessibilityLabel={tr('login.phone.accessibility')}
        />
        <InlineAlert message={error} />
        <Button title={tr('login.sendOtp')} onPress={() => void submit()} loading={busy} size="lg" fullWidth />

        {isDemoMode ? (
          <InlineAlert tone="warning" icon="flask-outline" title={tr('login.demo.title')} message={tr('login.demo.message')} />
        ) : null}

        <View style={{ gap: t.spacing.sm, paddingTop: t.spacing.xs }}>
          {(
            [
              ['shield-checkmark-outline', tr('login.benefit.verifiedPros')],
              ['document-text-outline', tr('login.benefit.itemisedQuote')],
              ['lock-closed-outline', tr('login.benefit.heldPayments')],
            ] as const
          ).map(([icon, x]) => (
            <View key={x} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
              <Ionicons name={icon} size={18} color={t.colors.success} />
              <Text variant="footnote" color="textSecondary">
                {x}
              </Text>
            </View>
          ))}
        </View>

        <Text variant="caption" color="muted" align="center" style={{ marginTop: t.spacing.sm, marginBottom: t.spacing.lg }}>
          {legalBeforeTerms ?? ''}
          <Text variant="caption" color="primaryText" style={{ textDecorationLine: 'underline' }} onPress={() => link('terms')} accessibilityRole="link">
            {tr('login.legal.terms')}
          </Text>
          {legalBetweenLinks}
          <Text variant="caption" color="primaryText" style={{ textDecorationLine: 'underline' }} onPress={() => link('privacy')} accessibilityRole="link">
            {tr('login.legal.privacy')}
          </Text>
          {legalAfterPrivacy}
        </Text>
        <Pressable
          accessibilityRole="link"
          onPress={() => link('help')}
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text variant="callout" color="primaryText" align="center" style={{ textDecorationLine: 'underline' }}>
            Need help signing in?
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}
