import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme';

type McIcon = ComponentProps<typeof MaterialCommunityIcons>['name'];

/** Category `icon` keys from the database → vector icon + brand tint. */
export const CATEGORY_VISUALS: Record<string, { icon: McIcon; tint: string }> = {
  snowflake: { icon: 'air-conditioner', tint: '#0BA5EC' },
  zap: { icon: 'flash', tint: '#F79009' },
  droplet: { icon: 'pipe-wrench', tint: '#1E5EFF' },
  home: { icon: 'broom', tint: '#12B76A' },
  database: { icon: 'storage-tank', tint: '#06AED4' },
  truck: { icon: 'car-wrench', tint: '#475467' },
  bike: { icon: 'motorbike', tint: '#7A5AF8' },
  tv: { icon: 'washing-machine', tint: '#6172F3' },
  bug: { icon: 'bug', tint: '#D92D20' },
  hammer: { icon: 'hammer-wrench', tint: '#B54708' },
  brush: { icon: 'format-paint', tint: '#EE46BC' },
};

export function categoryVisual(icon: string | undefined | null) {
  return CATEGORY_VISUALS[icon ?? ''] ?? { icon: 'tools' as McIcon, tint: '#1E5EFF' };
}

const SLUG_TO_ICON: Record<string, string> = {
  'ac-repair': 'snowflake',
  electrician: 'zap',
  plumber: 'droplet',
  'house-cleaning': 'home',
  'water-tank-cleaning': 'database',
  'car-mechanic': 'truck',
  'bike-mechanic': 'bike',
  'appliance-repair': 'tv',
  'pest-control': 'bug',
  carpenter: 'hammer',
  painter: 'brush',
};

export function iconForSlug(slug: string | undefined | null): string {
  return SLUG_TO_ICON[slug ?? ''] ?? '';
}

export function CategoryIcon({ icon, size = 52, radius }: { icon: string | undefined | null; size?: number; radius?: number }) {
  const t = useTheme();
  const v = categoryVisual(icon);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius ?? size * 0.32,
        backgroundColor: v.tint + (t.dark ? '2B' : '17'),
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <MaterialCommunityIcons name={v.icon} size={size * 0.5} color={t.dark ? lighten(v.tint) : v.tint} />
    </View>
  );
}

function lighten(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * 0.35);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
