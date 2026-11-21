import type { ErrorBoundaryProps } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { fallbackPalette, fallbackTypography } from '../theme/fallback';

/**
 * Shown by Expo Router when a screen throws while rendering. Without it a published build shows a blank screen.
 * Uses only plain React Native views and dependency-free fallback values so provider failures cannot hide it.
 */
export function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, gap: 12, backgroundColor: fallbackPalette.surface }}>
      <Text accessibilityRole="header" style={{ ...fallbackTypography.title2, color: fallbackPalette.text }}>Something went wrong on this screen</Text>
      <Text style={{ ...fallbackTypography.callout, color: fallbackPalette.textSecondary }}>Please send a screenshot of this message to the QuickServe team.</Text>
      <View style={{ padding: 12, borderRadius: 8, backgroundColor: fallbackPalette.surfaceAlt }}>
        <Text selectable style={{ ...fallbackTypography.footnote, color: fallbackPalette.dangerText }}>
          {error?.message || String(error)}
        </Text>
        {error?.stack ? (
          <Text selectable style={{ ...fallbackTypography.micro, color: fallbackPalette.muted, marginTop: 8 }} numberOfLines={12}>
            {error.stack}
          </Text>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Try again"
        onPress={() => void retry()}
        style={{ minHeight: 48, borderRadius: 12, backgroundColor: fallbackPalette.primary, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ ...fallbackTypography.button, color: fallbackPalette.onPrimary }}>Try again</Text>
      </Pressable>
    </ScrollView>
  );
}
