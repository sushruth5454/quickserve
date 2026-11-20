import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { View } from 'react-native';
import { categoryGlyphTints, useTheme } from '../theme';
import { CATEGORY_SLUG_TO_ICON } from './categoryIconMap';

type McIcon = ComponentProps<typeof MaterialCommunityIcons>['name'];
type CategoryGlyphTintKey = keyof typeof categoryGlyphTints;

function isCategoryGlyphTintKey(key: string): key is CategoryGlyphTintKey {
  return Object.prototype.hasOwnProperty.call(categoryGlyphTints, key);
}

/** Category `icon` keys from the database → vector icon + glyph tint (tiles themselves are neutral). */
export const CATEGORY_VISUALS: Record<string, { icon: McIcon; tint: string }> = {
  snowflake: { icon: 'air-conditioner', tint: categoryGlyphTints.snowflake.light },
  zap: { icon: 'flash', tint: categoryGlyphTints.zap.light },
  droplet: { icon: 'pipe-wrench', tint: categoryGlyphTints.droplet.light },
  home: { icon: 'broom', tint: categoryGlyphTints.home.light },
  database: { icon: 'storage-tank', tint: categoryGlyphTints.database.light },
  truck: { icon: 'car-wrench', tint: categoryGlyphTints.truck.light },
  bike: { icon: 'motorbike', tint: categoryGlyphTints.bike.light },
  tv: { icon: 'washing-machine', tint: categoryGlyphTints.tv.light },
  bug: { icon: 'bug', tint: categoryGlyphTints.bug.light },
  hammer: { icon: 'hammer-wrench', tint: categoryGlyphTints.hammer.light },
  brush: { icon: 'format-paint', tint: categoryGlyphTints.brush.light },
  // Creators, photo/video and weddings/events: one distinct glyph per category (keyed by slug).
  'instagram-influencer': { icon: 'instagram', tint: categoryGlyphTints['instagram-influencer'].light },
  'youtube-creator': { icon: 'youtube', tint: categoryGlyphTints['youtube-creator'].light },
  'ugc-creator': { icon: 'cellphone-play', tint: categoryGlyphTints['ugc-creator'].light },
  'reel-maker': { icon: 'movie-open-edit', tint: categoryGlyphTints['reel-maker'].light },
  'wedding-photographer': { icon: 'ring', tint: categoryGlyphTints['wedding-photographer'].light },
  'candid-photographer': { icon: 'camera-iris', tint: categoryGlyphTints['candid-photographer'].light },
  'pre-wedding-shoot': { icon: 'heart-multiple', tint: categoryGlyphTints['pre-wedding-shoot'].light },
  'maternity-newborn': { icon: 'baby-carriage', tint: categoryGlyphTints['maternity-newborn'].light },
  'product-photographer': { icon: 'package-variant-closed', tint: categoryGlyphTints['product-photographer'].light },
  'event-videographer': { icon: 'video-vintage', tint: categoryGlyphTints['event-videographer'].light },
  'drone-operator': { icon: 'quadcopter', tint: categoryGlyphTints['drone-operator'].light },
  'photo-booth': { icon: 'camera-party-mode', tint: categoryGlyphTints['photo-booth'].light },
  caterer: { icon: 'silverware-fork-knife', tint: categoryGlyphTints.caterer.light },
  decorator: { icon: 'balloon', tint: categoryGlyphTints.decorator.light },
  'bridal-makeup': { icon: 'lipstick', tint: categoryGlyphTints['bridal-makeup'].light },
  'mehendi-artist': { icon: 'hand-back-right', tint: categoryGlyphTints['mehendi-artist'].light },
  dj: { icon: 'headphones', tint: categoryGlyphTints.dj.light },
  'live-band': { icon: 'guitar-electric', tint: categoryGlyphTints['live-band'].light },
  'wedding-planner': { icon: 'calendar-heart', tint: categoryGlyphTints['wedding-planner'].light },
  'demo-home-tutor': { icon: 'school', tint: categoryGlyphTints['demo-home-tutor'].light },
  // Generic database `icon` keys for those categories (used when only the key is known).
  instagram: { icon: 'instagram', tint: categoryGlyphTints.instagram.light },
  youtube: { icon: 'youtube', tint: categoryGlyphTints.youtube.light },
  video: { icon: 'video', tint: categoryGlyphTints.video.light },
  camera: { icon: 'camera', tint: categoryGlyphTints.camera.light },
  restaurant: { icon: 'silverware-fork-knife', tint: categoryGlyphTints.restaurant.light },
  sparkles: { icon: 'party-popper', tint: categoryGlyphTints.sparkles.light },
  beauty: { icon: 'lipstick', tint: categoryGlyphTints.beauty.light },
  'hand-left': { icon: 'hand-back-right', tint: categoryGlyphTints['hand-left'].light },
  music: { icon: 'music', tint: categoryGlyphTints.music.light },
  briefcase: { icon: 'clipboard-text', tint: categoryGlyphTints.briefcase.light },
  school: { icon: 'school', tint: categoryGlyphTints.school.light },
};

export function categoryVisual(icon: string | undefined | null, dark = false) {
  const key = icon ?? '';
  const visual = CATEGORY_VISUALS[key] ?? { icon: 'tools' as McIcon, tint: categoryGlyphTints.default.light };
  const tint = isCategoryGlyphTintKey(key) ? categoryGlyphTints[key] : categoryGlyphTints.default;
  return { icon: visual.icon, tint: dark ? tint.dark : visual.tint };
}

export function iconForSlug(slug: string | undefined | null): string {
  const key = slug ?? '';
  return CATEGORY_SLUG_TO_ICON[key] ?? (CATEGORY_VISUALS[key] ? key : '');
}

/** Best icon key for a category row: its own slug visual first, then the database `icon` key. */
export function iconForCategory(category: { slug?: string | null; icon?: string | null } | null | undefined): string {
  return iconForSlug(category?.slug) || (category?.icon ?? '');
}

/** Neutral tile + tinted glyph: one surface colour for every category so the grid doesn't read as a rainbow. */
export function CategoryIcon({ icon, size = 52, radius }: { icon: string | undefined | null; size?: number; radius?: number }) {
  const t = useTheme();
  const v = categoryVisual(icon, t.dark);
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
      <MaterialCommunityIcons name={v.icon} size={Math.round(size * 0.46)} color={v.tint} />
    </View>
  );
}
