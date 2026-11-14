import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme';
import { lighten } from './ui';

type McIcon = ComponentProps<typeof MaterialCommunityIcons>['name'];

/** Category `icon` keys from the database → vector icon + glyph tint (tiles themselves are neutral). */
export const CATEGORY_VISUALS: Record<string, { icon: McIcon; tint: string }> = {
  snowflake: { icon: 'air-conditioner', tint: '#0086C9' },
  zap: { icon: 'flash', tint: '#B54708' },
  droplet: { icon: 'pipe-wrench', tint: '#1E5EFF' },
  home: { icon: 'broom', tint: '#067647' },
  database: { icon: 'storage-tank', tint: '#0E7090' },
  truck: { icon: 'car-wrench', tint: '#475467' },
  bike: { icon: 'motorbike', tint: '#6941C6' },
  tv: { icon: 'washing-machine', tint: '#444CE7' },
  bug: { icon: 'bug', tint: '#B42318' },
  hammer: { icon: 'hammer-wrench', tint: '#93370D' },
  brush: { icon: 'format-paint', tint: '#C11574' },
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

/** Neutral tile + tinted glyph: one surface colour for every category so the grid doesn't read as a rainbow. */
export function CategoryIcon({ icon, size = 52, radius }: { icon: string | undefined | null; size?: number; radius?: number }) {
  const t = useTheme();
  const v = categoryVisual(icon);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius ?? (size >= 56 ? t.radii.lg : t.radii.md),
        backgroundColor: t.dark ? t.colors.surfaceRaised : t.colors.surfaceAlt,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <MaterialCommunityIcons name={v.icon} size={Math.round(size * 0.46)} color={t.dark ? lighten(v.tint, 0.5) : v.tint} />
    </View>
  );
}
