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
  // Creators, photo/video and weddings/events: one distinct glyph per category (keyed by slug).
  'instagram-influencer': { icon: 'instagram', tint: '#C11574' },
  'youtube-creator': { icon: 'youtube', tint: '#D92D20' },
  'ugc-creator': { icon: 'cellphone-play', tint: '#6941C6' },
  'reel-maker': { icon: 'movie-open-edit', tint: '#444CE7' },
  'wedding-photographer': { icon: 'ring', tint: '#B54708' },
  'candid-photographer': { icon: 'camera-iris', tint: '#0E7090' },
  'pre-wedding-shoot': { icon: 'heart-multiple', tint: '#C11574' },
  'maternity-newborn': { icon: 'baby-carriage', tint: '#DD2590' },
  'product-photographer': { icon: 'package-variant-closed', tint: '#93370D' },
  'event-videographer': { icon: 'video-vintage', tint: '#475467' },
  'drone-operator': { icon: 'quadcopter', tint: '#0086C9' },
  'photo-booth': { icon: 'camera-party-mode', tint: '#6941C6' },
  caterer: { icon: 'silverware-fork-knife', tint: '#B54708' },
  decorator: { icon: 'balloon', tint: '#DD2590' },
  'bridal-makeup': { icon: 'lipstick', tint: '#C11574' },
  'mehendi-artist': { icon: 'hand-back-right', tint: '#93370D' },
  dj: { icon: 'headphones', tint: '#444CE7' },
  'live-band': { icon: 'guitar-electric', tint: '#B42318' },
  'wedding-planner': { icon: 'calendar-heart', tint: '#067647' },
  'demo-home-tutor': { icon: 'school', tint: '#1E5EFF' },
  // Generic database `icon` keys for those categories (used when only the key is known).
  instagram: { icon: 'instagram', tint: '#C11574' },
  youtube: { icon: 'youtube', tint: '#D92D20' },
  video: { icon: 'video', tint: '#444CE7' },
  camera: { icon: 'camera', tint: '#0E7090' },
  restaurant: { icon: 'silverware-fork-knife', tint: '#B54708' },
  sparkles: { icon: 'party-popper', tint: '#DD2590' },
  beauty: { icon: 'lipstick', tint: '#C11574' },
  'hand-left': { icon: 'hand-back-right', tint: '#93370D' },
  music: { icon: 'music', tint: '#444CE7' },
  briefcase: { icon: 'clipboard-text', tint: '#067647' },
  school: { icon: 'school', tint: '#1E5EFF' },
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
  const key = slug ?? '';
  return SLUG_TO_ICON[key] ?? (CATEGORY_VISUALS[key] ? key : '');
}

/** Best icon key for a category row: its own slug visual first, then the database `icon` key. */
export function iconForCategory(category: { slug?: string | null; icon?: string | null } | null | undefined): string {
  return iconForSlug(category?.slug) || (category?.icon ?? '');
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
