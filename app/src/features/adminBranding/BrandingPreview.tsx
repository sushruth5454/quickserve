import { Image } from 'expo-image';
import { Pressable, Text, View } from 'react-native';
import type { BrandingV1 } from '../../branding/types';

export function BrandingPreview({
  config,
  getAssetPreview,
}: {
  config: BrandingV1;
  getAssetPreview: (assetId: string) => string | null;
}) {
  const mode = config.defaultTheme === 'dark' ? 'dark' : 'light';
  const colors = config[mode];
  const logoId = mode === 'dark' ? config.assets.logoDark : config.assets.logoLight;
  const logoUrl = logoId ? getAssetPreview(logoId) : null;
  const pageColor = colors.bg ?? (mode === 'dark' ? '#0C1B21' : '#FFFFFF');
  const surfaceColor = colors.surface ?? pageColor;
  const textColor = colors.text ?? (mode === 'dark' ? '#EAF4F6' : '#18282E');
  const primaryColor = colors.primary ?? (mode === 'dark' ? '#80D4D4' : '#006D77');
  const onPrimaryColor = colors.onPrimary ?? (mode === 'dark' ? '#003B42' : '#FFFFFF');

  return (
    <View
      accessibilityLabel="Isolated appearance preview"
      style={{ gap: 12, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.border ?? '#DEE5E7', backgroundColor: pageColor }}
    >
      <Text style={{ color: colors.muted ?? textColor, fontSize: 12, fontWeight: '600' }}>Isolated {mode} preview · never applied to the app theme</Text>
      <View style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {logoUrl ? (
          <Image
            source={{ uri: logoUrl }}
            cachePolicy="none"
            contentFit="contain"
            accessibilityLabel="Uploaded branding image preview"
            style={{ width: 120, height: 40 }}
          />
        ) : (
          <Text style={{ color: colors.muted ?? textColor, fontSize: 12 }}>{logoId ? 'Image preview unavailable or expired' : 'No uploaded logo selected'}</Text>
        )}
      </View>
      <View style={{ gap: 6, padding: 14, borderRadius: 12, backgroundColor: surfaceColor }}>
        <Text style={{ color: textColor, fontSize: 18, fontWeight: '700' }}>{config.displayName}</Text>
        <Text style={{ color: colors.textSecondary ?? textColor, fontSize: 14 }}>{config.tagline}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sample preview action"
        style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: primaryColor }}
      >
        <Text style={{ color: onPrimaryColor, fontSize: 14, fontWeight: '600' }}>Sample action</Text>
      </Pressable>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[primaryColor, colors.secondary ?? primaryColor, colors.accent ?? primaryColor].map((color, index) => (
          <View key={`${color}-${index}`} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: color }} />
        ))}
      </View>
    </View>
  );
}
