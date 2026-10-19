import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../../src/components/Button';
import { ErrorText, Field, Screen } from '../../src/components/Screen';
import { sendOtp } from '../../src/lib/api';
import { isSupabaseConfigured } from '../../src/lib/supabase';
import { colors, font, spacing } from '../../src/lib/theme';

function normalizeIndianPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;
  return null;
}

export default function LoginScreen() {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const e164 = normalizeIndianPhone(phone);
    if (!e164) {
      setError('Enter a valid 10-digit mobile number.');
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
    <Screen>
      <View style={styles.hero}>
        <Text style={styles.brand}>QuickServe</Text>
        <Text style={font.caption}>Trusted local pros, booked in 60 seconds.</Text>
      </View>
      {!isSupabaseConfigured && (
        <ErrorText message="Supabase is not configured. Copy .env.example to .env and restart Expo." />
      )}
      <Field
        label="Mobile number"
        placeholder="98765 43210"
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        value={phone}
        onChangeText={setPhone}
        maxLength={14}
      />
      <ErrorText message={error} />
      <Button title="Send OTP" onPress={submit} loading={busy} />
      <Text style={font.caption}>We will text you a one-time code. No passwords.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { gap: spacing.xs, paddingVertical: spacing.xl },
  brand: { fontSize: 32, fontWeight: '800', color: colors.primary },
});
