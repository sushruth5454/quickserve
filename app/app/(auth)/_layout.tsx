import { Stack } from 'expo-router';
import { useTheme } from '../../src/theme';

export const unstable_settings = { initialRouteName: 'login' };

export default function AuthLayout() {
  const t = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.colors.bg }, animation: 'slide_from_right' }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="verify" />
      <Stack.Screen name="role" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
