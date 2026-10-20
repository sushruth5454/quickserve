import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Header, InlineAlert, OTPInput, Screen, Text, useToast } from '../../src/components/ui';
import { isDemoMode, sendOtp, verifyOtp } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { haptics } from '../../src/lib/haptics';
import { formatPhone } from '../../src/lib/phone';
import { useTheme } from '../../src/theme';

const RESEND_SECONDS = 30;

export default function VerifyScreen() {
  const t = useTheme();
  const toast = useToast();
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const { setChoosingRole } = useAuth();
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
      router.replace('/role');
    } catch (e) {
      setChoosingRole(false);
      haptics.error();
      setError((e as Error).message);
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
      setError((e as Error).message);
    }
  };

  return (
    <Screen header={<Header />} background={t.colors.surface} contentStyle={{ paddingHorizontal: t.spacing.xxl }} gap={t.spacing.xxl}>
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="title1" accessibilityRole="header">
          Verify your number
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          <Text variant="body" color="muted">
            Enter the code sent to
          </Text>
          <Text variant="bodyStrong">{formatPhone(phone)}</Text>
          <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={12}>
            <Text variant="subhead" color="primary">
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
      {isDemoMode ? <InlineAlert tone="info" icon="sparkles" message="Demo mode: the code is 123456." /> : null}

      <Button title="Verify & continue" onPress={() => void submit()} loading={busy} disabled={code.length !== 6} size="lg" fullWidth />

      <View style={{ alignItems: 'center' }}>
        {left > 0 ? (
          <Text variant="callout" color="muted">
            Resend code in <Text variant="subhead">0:{String(left).padStart(2, '0')}</Text>
          </Text>
        ) : (
          <Button title="Resend code" variant="ghost" onPress={() => void resend()} leftIcon="refresh" />
        )}
      </View>
    </Screen>
  );
}
