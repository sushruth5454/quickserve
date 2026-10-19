import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Button } from '../../src/components/Button';
import { ErrorText, Field, Screen } from '../../src/components/Screen';
import { sendOtp, verifyOtp } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { font } from '../../src/lib/theme';

export default function VerifyScreen() {
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const { setChoosingRole } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!phone || !/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setChoosingRole(true);
      await verifyOtp(phone, code);
      router.replace('/role');
    } catch (e) {
      setChoosingRole(false);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!phone) return;
    try {
      await sendOtp(phone);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Screen>
      <Text style={font.title}>Enter the code</Text>
      <Text style={font.caption}>Sent to {phone}</Text>
      <Field
        label="6-digit code"
        keyboardType="number-pad"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        value={code}
        onChangeText={(t) => setCode(t.replace(/\D/g, ''))}
        maxLength={6}
      />
      <ErrorText message={error} />
      <Button title="Verify" onPress={submit} loading={busy} />
      <Button title="Resend code" variant="ghost" onPress={resend} />
    </Screen>
  );
}
