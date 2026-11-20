import type { ErrorBoundaryProps } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { lightPalette, typography } from '../theme';

/**
 * Shown by Expo Router when a screen throws while rendering. Without it a published build shows a blank screen.
 * Deliberately uses plain React Native views (no theme/context), so it still renders if those are what failed.
 */
export function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, gap: 12, backgroundColor: lightPalette.surface }}>
      <Text style={{ fontSize: typography.title2.fontSize, fontWeight: '700', color: lightPalette.text }}>Something went wrong on this screen</Text>
      <Text style={{ fontSize: typography.callout.fontSize, color: lightPalette.textSecondary }}>Please send a screenshot of this message to the QuickServe team.</Text>
      <View style={{ padding: 12, borderRadius: 8, backgroundColor: lightPalette.surfaceAlt }}>
        <Text selectable style={{ fontSize: typography.footnote.fontSize, color: lightPalette.dangerText }}>
          {error?.message || String(error)}
        </Text>
        {error?.stack ? (
          <Text selectable style={{ fontSize: typography.micro.fontSize, color: lightPalette.muted, marginTop: 8 }} numberOfLines={12}>
            {error.stack}
          </Text>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Try again"
        onPress={() => void retry()}
        style={{ minHeight: 48, borderRadius: 12, backgroundColor: lightPalette.primary, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ color: lightPalette.onPrimary, fontSize: typography.button.fontSize, fontWeight: '600' }}>Try again</Text>
      </Pressable>
    </ScrollView>
  );
}
