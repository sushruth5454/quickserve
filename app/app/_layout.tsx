import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { useFonts } from 'expo-font';
import { router, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ConfirmProvider, FullScreenLoader, ToastProvider } from '../src/components/ui';
import { AuthProvider, useAuth } from '../src/lib/auth';
import { PaymentProvider } from '../src/lib/payments';
import { ThemeProvider, useTheme } from '../src/theme';

function RootNavigator() {
  const { session, loading, choosingRole } = useAuth();
  const t = useTheme();
  const segments = useSegments();
  const signedIn = !!session;
  const inAuthGroup = segments[0] === '(auth)';
  // Public pages (safety, terms, privacy) are linked from the login screen.
  const onPublicPage = segments[0] === 'info';

  // Signed out anywhere outside the auth screens (cold start on a deep link or "/", or right after logout):
  // the protected routes no longer match, so send the user to the login screen instead of "Unmatched Route".
  useEffect(() => {
    if (!loading && !signedIn && !inAuthGroup && !onPublicPage) router.replace('/login');
  }, [loading, signedIn, inAuthGroup, onPublicPage]);

  if (loading) return <FullScreenLoader />;
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.colors.bg },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Protected guard={!signedIn || choosingRole}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !choosingRole}>
        <Stack.Screen name="(customer)" options={{ animation: 'fade' }} />
        <Stack.Screen name="(provider)" options={{ animation: 'fade' }} />
        <Stack.Screen name="category/[slug]" />
        <Stack.Screen name="provider/[id]" />
        <Stack.Screen name="book/[providerServiceId]" />
        <Stack.Screen name="booking/[id]" />
        <Stack.Screen name="chat/[bookingId]" />
        <Stack.Screen name="quote/[bookingId]" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="jobs" />
      </Stack.Protected>
      <Stack.Screen name="info/[topic]" />
    </Stack>
  );
}

function ThemedApp() {
  const t = useTheme();
  return (
    <ToastProvider>
      <ConfirmProvider>
        <AuthProvider>
          <PaymentProvider>
            <StatusBar style={t.dark ? 'light' : 'dark'} />
            <RootNavigator />
          </PaymentProvider>
        </AuthProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>{fontsLoaded || fontError ? <ThemedApp /> : <FullScreenLoader />}</ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
