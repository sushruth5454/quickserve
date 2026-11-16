import type { ErrorBoundaryProps } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

/**
 * Shown by Expo Router when a screen throws while rendering. Without it a published build shows a blank screen.
 * Deliberately uses plain React Native views (no theme/context), so it still renders if those are what failed.
 */
export function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, gap: 12, backgroundColor: '#ffffff' }}>
      <Text style={{ fontSize: 20, fontWeight: '700', color: '#0f172a' }}>Something went wrong on this screen</Text>
      <Text style={{ fontSize: 15, color: '#475569' }}>Please send a screenshot of this message to the QuickServe team.</Text>
      <View style={{ padding: 12, borderRadius: 8, backgroundColor: '#f1f5f9' }}>
        <Text selectable style={{ fontSize: 13, color: '#b91c1c' }}>
          {error?.message || String(error)}
        </Text>
        {error?.stack ? (
          <Text selectable style={{ fontSize: 11, color: '#64748b', marginTop: 8 }} numberOfLines={12}>
            {error.stack}
          </Text>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() => void retry()}
        style={{ minHeight: 48, borderRadius: 12, backgroundColor: '#2563eb', alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '600' }}>Try again</Text>
      </Pressable>
    </ScrollView>
  );
}
