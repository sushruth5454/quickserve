import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { useFonts } from 'expo-font';
import { router, Stack, usePathname, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, View } from 'react-native';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ConfirmProvider, FullScreenLoader, Text, ToastProvider } from '../src/components/ui';
import { DemoDataIndicator } from '../src/components/DemoDataIndicator';
import { AuthProvider, useAuth } from '../src/lib/auth';
import { LocationProvider } from '../src/lib/locationContext';
import { PaymentProvider } from '../src/lib/payments';
import { configureForegroundHandling, registerForPush, resetPushRegistration, setAppBadge, useNotificationRouting } from '../src/lib/push';
import { UnreadProvider, useUnread } from '../src/lib/unreadContext';
import { LanguageProvider } from '../src/i18n';
import { ThemeProvider, useTheme } from '../src/theme';
import { RouteErrorBoundary } from '../src/components/RouteErrorBoundary';
import { canGuestBrowse, isBrowseRoute, isGuestGatedCustomerTab, safeReturnTo } from '../src/lib/authGate';
import { isFeatureOn } from '../src/lib/featureFlagModel';
import {
  FeatureFlagsProvider,
  getGuestRouteDisposition,
  useFeatureControlHydrationReady,
  useFeatureControlState,
} from '../src/branding/FeatureFlagsProvider';
import { AppearanceProvider } from '../src/branding/AppearanceProvider';

export { RouteErrorBoundary as ErrorBoundary };

/** Push plumbing: foreground filter, silent token refresh, tap-to-open routing and the app icon badge. */
function NotificationsBridge({ ready }: { ready: boolean }) {
  const { userId } = useAuth();
  const { activeChat, total } = useUnread();
  const unreadTotal = total();

  useEffect(() => {
    configureForegroundHandling(activeChat);
  }, [activeChat]);

  useEffect(() => {
    // Only refreshes the token when permission was granted before; the prompt is shown at meaningful moments.
    if (userId) void registerForPush(userId, { prompt: false });
    else resetPushRegistration();
  }, [userId]);

  useNotificationRouting(ready, userId);

  useEffect(() => {
    void setAppBadge(unreadTotal);
  }, [unreadTotal]);

  return null;
}

function RootNavigator() {
  const { session, loading, restoreStatus, retryRestore, choosingRole } = useAuth();
  const t = useTheme();
  const segments = useSegments();
  const currentPath = usePathname();
  const { features } = useFeatureControlState();
  const featureControlHydrated = useFeatureControlHydrationReady();
  const signedIn = !!session;
  const inAuthGroup = segments[0] === '(auth)';
  // Public pages (safety, terms, privacy) are linked from the login screen.
  const onPublicPage = segments[0] === 'info' || segments[0] === 'byo';
  const potentialGuestEntryRoute = isBrowseRoute(segments) || isGuestGatedCustomerTab(segments);
  const guestBrowse = isFeatureOn(features, 'guest_browse');
  const canEnterAsGuest = canGuestBrowse(guestBrowse, segments);
  const guestRouteDisposition = getGuestRouteDisposition({
    controlsReady: featureControlHydrated,
    restoreStatus,
    inAuthGroup,
    onPublicPage,
    potentialGuestEntryRoute,
    canEnterAsGuest,
  });
  const awaitingGuestFlag = guestRouteDisposition === 'wait';
  const returnTo = safeReturnTo(currentPath) ? currentPath : '/';

  // Signed out anywhere outside the auth screens (cold start on a deep link or "/", or right after logout):
  // the protected routes no longer match, so send the user to the login screen instead of "Unmatched Route".
  useEffect(() => {
    if (
      !loading &&
      restoreStatus !== 'error' &&
      guestRouteDisposition === 'redirect'
    ) {
      router.replace({ pathname: '/login', params: { returnTo } });
    }
  }, [loading, restoreStatus, guestRouteDisposition, returnTo]);

  if (!loading && restoreStatus === 'error') {
    return (
      <View
        accessibilityRole="alert"
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          backgroundColor: t.colors.bg,
        }}
      >
        <Text variant="title3" style={{ marginBottom: 8 }}>
          Your session could not be restored
        </Text>
        <Text variant="body" align="center" style={{ marginBottom: 20 }}>
          We could not verify your session. Check your connection and try again.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void retryRestore()}
          style={{
            minHeight: 44,
            minWidth: 120,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 10,
            paddingHorizontal: 20,
            backgroundColor: t.colors.primary,
          }}
        >
          <Text variant="button" color="onPrimary">Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (loading || awaitingGuestFlag) return <FullScreenLoader />;
  return (
    <>
      <NotificationsBridge ready={signedIn && !choosingRole} />
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
        <Stack.Protected guard={(signedIn && !choosingRole) || (!signedIn && canEnterAsGuest)}>
          <Stack.Screen name="(customer)" options={{ animation: 'fade' }} />
          <Stack.Screen name="category/[slug]" />
          <Stack.Screen name="provider/[id]" />
          <Stack.Screen name="top-rated" />
          <Stack.Screen name="location" options={{ animation: 'slide_from_bottom' }} />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !choosingRole}>
          <Stack.Screen name="(provider)" options={{ animation: 'fade' }} />
          <Stack.Screen name="book/[providerServiceId]" />
          <Stack.Screen name="booking/[id]" />
          <Stack.Screen name="chat/[bookingId]" />
          <Stack.Screen name="quote/[bookingId]" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="jobs" />
          <Stack.Screen name="assistant" />
        </Stack.Protected>
        <Stack.Screen name="info/[topic]" />
        <Stack.Screen name="byo/[token]" />
      </Stack>
    </>
  );
}

function ThemedApp() {
  const t = useTheme();
  return (
    <ToastProvider>
      <ConfirmProvider>
        <AuthProvider>
          <LanguageProvider>
            <UnreadProvider>
              <LocationProvider>
                <PaymentProvider>
                  <StatusBar style={t.dark ? 'light' : 'dark'} />
                  <RootNavigator />
                  <DemoDataIndicator />
                </PaymentProvider>
              </LocationProvider>
            </UnreadProvider>
          </LanguageProvider>
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
    Manrope_600SemiBold: require('../assets/fonts/Manrope-SemiBold.ttf'),
    Manrope_700Bold: require('../assets/fonts/Manrope-Bold.ttf'),
  });
  const [fontReadinessExpired, setFontReadinessExpired] = useState(false);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      setFontReadinessExpired(true);
      return;
    }
    const deadline = setTimeout(() => setFontReadinessExpired(true), 1000);
    return () => clearTimeout(deadline);
  }, [fontsLoaded, fontError]);

  const appFontsReady = fontsLoaded || fontError || fontReadinessExpired;
  const headingsUseManrope = fontsLoaded && !fontError;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <FeatureFlagsProvider>
          <AppearanceProvider>
            <ThemeProvider manropeReady={headingsUseManrope}>
              {appFontsReady ? <ThemedApp /> : <FullScreenLoader />}
            </ThemeProvider>
          </AppearanceProvider>
        </FeatureFlagsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
