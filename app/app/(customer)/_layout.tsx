import { Stack } from 'expo-router';
import { colors } from '../../src/lib/theme';

export const unstable_settings = { initialRouteName: 'index' };

export default function CustomerLayout() {
  return (
    <Stack screenOptions={{ headerTintColor: colors.primary, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="index" options={{ title: 'QuickServe' }} />
      <Stack.Screen name="category/[slug]" options={{ title: 'Providers' }} />
      <Stack.Screen name="provider/[id]" options={{ title: 'Provider' }} />
      <Stack.Screen name="book/[providerServiceId]" options={{ title: 'Book' }} />
      <Stack.Screen name="bookings" options={{ title: 'My bookings' }} />
    </Stack>
  );
}
