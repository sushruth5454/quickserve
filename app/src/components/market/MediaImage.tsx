import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import type { JSX } from 'react';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../theme';
import { type IconName } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';

interface MediaImageProps {
  uri?: string | null;
  aspectRatio: number;
  radius?: number;
  fallbackIcon: IconName;
  accessibilityLabel?: string;
}

export function MediaImage({
  uri,
  aspectRatio,
  radius,
  fallbackIcon,
  accessibilityLabel,
}: MediaImageProps): JSX.Element {
  const t = useTheme();
  const [loadState, setLoadState] = useState<{ uri: string; status: 'loaded' | 'failed' } | null>(null);
  const status = !uri ? 'failed' : loadState?.uri === uri ? loadState.status : 'loading';
  const cornerRadius = radius ?? t.radii.lg;

  return (
    <View
      accessible={!!accessibilityLabel}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={{
        width: '100%',
        aspectRatio,
        overflow: 'hidden',
        borderRadius: cornerRadius,
        backgroundColor: t.colors.surfaceAlt,
      }}
    >
      {uri && status !== 'failed' ? (
        <Image
          source={{ uri }}
          contentFit="cover"
          onLoad={() => setLoadState({ uri, status: 'loaded' })}
          onError={() => setLoadState({ uri, status: 'failed' })}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={fallbackIcon} size={t.iconSize.xl} color={t.colors.subtle} />
        </View>
      )}
      {status === 'loading' ? (
        <Skeleton
          width="100%"
          height={1}
          radius={cornerRadius}
          style={[StyleSheet.absoluteFill, { height: '100%' }]}
        />
      ) : null}
    </View>
  );
}
