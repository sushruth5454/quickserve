import { Stack } from 'expo-router';
import { useTheme } from '../../src/theme';
import { useNavigationIdentityOptions } from '../../src/components/tabOptions';

export const unstable_settings = { initialRouteName: 'login' };

export default function AuthLayout() {
  const t = useTheme();
  const identityOptions = useNavigationIdentityOptions('auth');
  return (
    <Stack screenOptions={{ ...identityOptions, contentStyle: { backgroundColor: t.colors.bg }, animation: 'slide_from_right' }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="verify" />
      <Stack.Screen name="role" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
