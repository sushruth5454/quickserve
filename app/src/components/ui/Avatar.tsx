import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../../theme';
import { Text } from './Text';

// Calm, distinguishable hues. No red/orange: those read as error/warning next to a name.
const HUES = ['#1E5EFF', '#6172F3', '#7A5AF8', '#0E9384', '#0086C9', '#C11574', '#4E5BA6', '#B54708'];

function hashHue(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length] ?? HUES[0]!;
}

export function lighten(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function initials(name: string): string {
  // Ignore leading punctuation, e.g. "Chandra Sekhar (PestGuard)" → "CP", not "C(".
  const parts = name
    .trim()
    .split(/\s+/)
    .map((p) => p.replace(/^[^\w\u0900-\u0DFF]+/, ''))
    .filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]![0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '';
  return (first + last).toUpperCase();
}

interface Props {
  name: string;
  uri?: string | null;
  size?: number;
  online?: boolean;
  verified?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Avatar({ name, uri, size = 48, online, verified, style }: Props) {
  const t = useTheme();
  const hue = hashHue(name || '?');
  const badge = Math.max(14, Math.round(size * 0.3));
  return (
    <View style={[{ width: size, height: size }, style]} accessible accessibilityLabel={`${name} avatar`}>
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          contentFit="cover"
          transition={200}
        />
      ) : (
        <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.colors.surface }}>
          <View
            style={{
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: t.dark ? t.colors.surfaceRaised : hue + '1A',
              borderWidth: t.dark ? 1 : 0,
              borderColor: t.colors.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text
              variant="bodyStrong"
              style={{ color: t.dark ? lighten(hue, 0.45) : hue, fontSize: size * 0.38, lineHeight: size * 0.46 }}
              maxFontSizeMultiplier={1}
            >
              {initials(name)}
            </Text>
          </View>
        </View>
      )}
      {online ? (
        <View
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: badge * 0.8,
            height: badge * 0.8,
            borderRadius: badge,
            backgroundColor: t.colors.success,
            borderWidth: 2,
            borderColor: t.colors.surface,
          }}
        />
      ) : null}
      {verified && !online ? (
        <View
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: badge,
            height: badge,
            borderRadius: badge / 2,
            backgroundColor: t.colors.primary,
            borderWidth: 2,
            borderColor: t.colors.surface,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="checkmark" size={Math.round(badge * 0.6)} color="#FFFFFF" />
        </View>
      ) : null}
    </View>
  );
}
