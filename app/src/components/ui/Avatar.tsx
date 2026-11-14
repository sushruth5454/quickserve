import { Image } from 'expo-image';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../../theme';
import { Text } from './Text';

const HUES = ['#1E5EFF', '#7A5AF8', '#EE46BC', '#F79009', '#12B76A', '#0BA5EC', '#F04438', '#6172F3'];

function hashHue(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length] ?? HUES[0]!;
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
  const badge = Math.max(12, Math.round(size * 0.28));
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
            backgroundColor: hue + (t.dark ? '33' : '1F'),
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            variant="bodyStrong"
            style={{ color: t.dark ? '#FFFFFF' : hue, fontSize: size * 0.36, lineHeight: size * 0.44 }}
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
            backgroundColor: t.colors.success,
            borderWidth: 2,
            borderColor: t.colors.surface,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: badge * 0.55, lineHeight: badge * 0.7 }} maxFontSizeMultiplier={1}>
            ✓
          </Text>
        </View>
      ) : null}
    </View>
  );
}
