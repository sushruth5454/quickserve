import { useMemo } from 'react';
import { Image } from 'expo-image';
import { View } from 'react-native';
import {
  createAppearanceProviderElement,
  type AppearanceState,
} from '../../branding/AppearanceProvider';
import { OORVA_BRANDING_CANDIDATE } from '../../branding/defaults';
import type { BrandingV1 } from '../../branding/types';
import { Text } from '../../components/ui';
import { ThemeProvider, useTheme } from '../../theme';

export function BrandingPreview({
  config,
  getAssetPreview,
}: {
  config: BrandingV1;
  getAssetPreview: (assetId: string) => string | null;
}) {
  const appearance = useMemo<AppearanceState>(() => ({
    brandingEnabled: true,
    runtimeEnabled: true,
    config,
    refresh: async () => undefined,
  }), [config]);

  return createAppearanceProviderElement(
    appearance,
    <ThemeProvider>
      <PreviewContent config={config} getAssetPreview={getAssetPreview} />
    </ThemeProvider>,
  );
}

function PreviewContent({
  config,
  getAssetPreview,
}: {
  config: BrandingV1;
  getAssetPreview: (assetId: string) => string | null;
}) {
  const theme = useTheme();
  const mode = theme.dark ? 'dark' : 'light';
  const colors = { ...OORVA_BRANDING_CANDIDATE[mode], ...config[mode] };
  const logoId = mode === 'dark'
    ? config.assets.logoDark ?? config.assets.logoLight
    : config.assets.logoLight ?? config.assets.logoDark;
  const logoUrl = logoId ? getAssetPreview(logoId) : null;

  return (
    <View
      accessibilityLabel="Isolated appearance preview"
      style={{
        gap: theme.spacing.md,
        padding: theme.spacing.lg,
        borderRadius: theme.radii.lg,
        borderWidth: 1,
        borderColor: colors.border ?? theme.colors.border,
        backgroundColor: colors.bg ?? theme.colors.bg,
      }}
    >
      <Text variant="caption" style={{ color: colors.muted ?? theme.colors.muted }}>
        Isolated {mode} preview · never applied to the app theme
      </Text>
      <View style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        {logoUrl ? (
          <Image
            source={{ uri: logoUrl }}
            cachePolicy="none"
            contentFit="contain"
            accessibilityLabel="Uploaded branding image preview"
            style={{ width: 120, height: 40 }}
          />
        ) : (
          <Text variant="caption" color="muted">
            {logoId ? 'Image preview unavailable or expired' : 'No uploaded logo selected'}
          </Text>
        )}
      </View>
      <View
        style={{
          gap: theme.spacing.xs,
          padding: theme.spacing.md,
          borderRadius: theme.radii.md,
          backgroundColor: colors.surface ?? theme.colors.surface,
        }}
      >
        <Text variant="title3" style={{ color: colors.text ?? theme.colors.text }}>
          {config.displayName}
        </Text>
        <Text variant="body" style={{ color: colors.textSecondary ?? theme.colors.textSecondary }}>
          {config.tagline}
        </Text>
      </View>
      <View
        accessibilityRole="button"
        accessibilityLabel="Sample preview action"
        style={{
          minHeight: theme.minTouch,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: theme.radii.md,
          backgroundColor: colors.primary ?? theme.colors.primary,
        }}
      >
        <Text variant="button" style={{ color: colors.onPrimary ?? theme.colors.onPrimary }}>
          Sample action
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        {[colors.primary, colors.secondary, colors.accent].map((color, index) => (
          <View
            key={`${color}-${index}`}
            style={{
              width: theme.spacing.xxl,
              height: theme.spacing.xxl,
              borderRadius: theme.radii.pill,
              backgroundColor: color ?? theme.colors.primary,
            }}
          />
        ))}
      </View>
    </View>
  );
}
