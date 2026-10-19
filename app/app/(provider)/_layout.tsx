import { Stack } from 'expo-router';
import { colors } from '../../src/lib/theme';

export const unstable_settings = { initialRouteName: 'dashboard' };

export default function ProviderLayout() {
  return (
    <Stack screenOptions={{ headerTintColor: colors.primary, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="dashboard" options={{ title: 'Pro dashboard' }} />
      <Stack.Screen name="jobs" options={{ title: 'All jobs' }} />
      <Stack.Screen name="earnings" options={{ title: 'Earnings' }} />
      <Stack.Screen name="onboarding" options={{ title: 'Provider profile' }} />
    </Stack>
  );
}
