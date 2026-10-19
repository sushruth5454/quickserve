import { Stack } from 'expo-router';
import { colors } from '../../src/lib/theme';

export const unstable_settings = { initialRouteName: 'login' };

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerTintColor: colors.primary, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="login" options={{ title: 'Sign in' }} />
      <Stack.Screen name="verify" options={{ title: 'Verify' }} />
      <Stack.Screen name="role" options={{ title: 'Welcome', headerBackVisible: false }} />
    </Stack>
  );
}
