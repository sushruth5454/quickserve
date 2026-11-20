import type { TextStyle } from 'react-native';
import { Easing } from 'react-native-reanimated';

export interface Palette {
  primary: string;
  primaryPressed: string;
  primarySoft: string;
  /** Primary used as text/icon on surfaces (links, active tab, selected chip label). */
  primaryText: string;
  onPrimary: string;
  /** Green is a status colour only (paid, completed, verified). Never a CTA fill. */
  success: string;
  successStrong: string;
  successSoft: string;
  successText: string;
  warning: string;
  warningSoft: string;
  warningText: string;
  danger: string;
  /** Destructive button fill (white text passes AA). */
  dangerStrong: string;
  dangerSoft: string;
  dangerText: string;
  info: string;
  infoSoft: string;
  infoText: string;
  text: string;
  textSecondary: string;
  muted: string;
  /** Decorative only (chevrons, disabled content). Not for readable text. */
  subtle: string;
  bg: string;
  surface: string;
  surfaceAlt: string;
  surfaceRaised: string;
  surfaceOverlay: string;
  border: string;
  borderStrong: string;
  /** 3:1 boundary for interactive controls: inputs, OTP boxes, radios, switch-off track, empty stars. */
  outline: string;
  star: string;
  overlay: string;
  skeleton: string;
  bubbleMine: string;
  bubbleTheirs: string;
  heroFrom: string;
  heroTo: string;
  toastBg: string;
  toastBorder: string;
  segmentThumb: string;
  /** Category identity (pillars) only. Never status, never CTA fill. */
  catHome: string;
  catHomeSoft: string;
  catShops: string;
  catShopsSoft: string;
  catSports: string;
  catSportsSoft: string;
  catCreators: string;
  catCreatorsSoft: string;
}

export const lightPalette: Palette = {
  primary: '#1F4FD1',
  primaryPressed: '#1A40AA',
  primarySoft: '#EEF2FD',
  primaryText: '#1F4FD1',
  onPrimary: '#FFFFFF',
  success: '#12B76A',
  successStrong: '#067647',
  successSoft: '#ECFDF3',
  successText: '#067647',
  warning: '#F79009',
  warningSoft: '#FFFAEB',
  warningText: '#B54708',
  danger: '#F04438',
  dangerStrong: '#D92D20',
  dangerSoft: '#FEF3F2',
  dangerText: '#B42318',
  info: '#0BA5EC',
  infoSoft: '#F0F9FF',
  infoText: '#026AA2',
  text: '#101828',
  textSecondary: '#344054',
  muted: '#667085',
  subtle: '#98A2B3',
  bg: '#F6F7F9',
  surface: '#FFFFFF',
  surfaceAlt: '#F2F4F7',
  surfaceRaised: '#FFFFFF',
  surfaceOverlay: '#FFFFFF',
  border: '#EAECF0',
  borderStrong: '#D0D5DD',
  outline: '#8C95A6',
  star: '#FDB022',
  overlay: 'rgba(16,24,40,0.45)',
  skeleton: '#E9ECF1',
  bubbleMine: '#1F4FD1',
  bubbleTheirs: '#F2F4F7',
  heroFrom: '#1F4FD1',
  heroTo: '#1A40AA',
  toastBg: '#101828',
  toastBorder: '#101828',
  segmentThumb: '#FFFFFF',
  catHome: '#0F766E',
  catHomeSoft: '#E6F4F1',
  catShops: '#B45309',
  catShopsSoft: '#FEF3E2',
  catSports: '#BE185D',
  catSportsSoft: '#FCE7F1',
  catCreators: '#6D28D9',
  catCreatorsSoft: '#F1EBFE',
};

export const darkPalette: Palette = {
  primary: '#2A62EA',
  primaryPressed: '#2253C9',
  primarySoft: '#17244A',
  primaryText: '#7DA0FF',
  onPrimary: '#FFFFFF',
  success: '#32D583',
  successStrong: '#6CE9A6',
  successSoft: '#0E2C20',
  successText: '#6CE9A6',
  warning: '#FDB022',
  warningSoft: '#33250B',
  warningText: '#FEC84B',
  danger: '#F97066',
  dangerStrong: '#D92D20',
  dangerSoft: '#3A1513',
  dangerText: '#FDA29B',
  info: '#36BFFA',
  infoSoft: '#0B2B3D',
  infoText: '#7CD4FD',
  text: '#F5F7FA',
  textSecondary: '#D0D5DD',
  muted: '#98A2B3',
  subtle: '#7A8699',
  bg: '#0B111C',
  surface: '#131B29',
  surfaceAlt: '#1B2434',
  surfaceRaised: '#1B2434',
  surfaceOverlay: '#1B2434',
  border: '#263247',
  borderStrong: '#344054',
  outline: '#66748C',
  star: '#FDB022',
  overlay: 'rgba(0,0,0,0.6)',
  skeleton: '#1E283A',
  bubbleMine: '#2A62EA',
  bubbleTheirs: '#1B2434',
  heroFrom: '#1A3FB8',
  heroTo: '#142F8A',
  toastBg: '#1F2A3D',
  toastBorder: '#344054',
  segmentThumb: '#2A3550',
  catHome: '#5EEAD4',
  catHomeSoft: '#0B2A27',
  catShops: '#FCD34D',
  catShopsSoft: '#2E2208',
  catSports: '#F9A8D4',
  catSportsSoft: '#33101F',
  catCreators: '#C4B5FD',
  catCreatorsSoft: '#221447',
};

export const categoryGlyphTints = {
  default: { light: '#1E5EFF', dark: '#8FAFFF' },
  snowflake: { light: '#0086C9', dark: '#80C3E4' },
  zap: { light: '#B54708', dark: '#DAA384' },
  droplet: { light: '#1E5EFF', dark: '#8FAFFF' },
  home: { light: '#067647', dark: '#83BBA3' },
  database: { light: '#0E7090', dark: '#87B8C8' },
  truck: { light: '#475467', dark: '#A3AAB3' },
  bike: { light: '#6941C6', dark: '#B4A0E3' },
  tv: { light: '#444CE7', dark: '#A2A6F3' },
  bug: { light: '#B42318', dark: '#DA918C' },
  hammer: { light: '#93370D', dark: '#C99B86' },
  brush: { light: '#C11574', dark: '#E08ABA' },
  'instagram-influencer': { light: '#C11574', dark: '#E08ABA' },
  'youtube-creator': { light: '#D92D20', dark: '#EC9690' },
  'ugc-creator': { light: '#6941C6', dark: '#B4A0E3' },
  'reel-maker': { light: '#444CE7', dark: '#A2A6F3' },
  'wedding-photographer': { light: '#B54708', dark: '#DAA384' },
  'candid-photographer': { light: '#0E7090', dark: '#87B8C8' },
  'pre-wedding-shoot': { light: '#C11574', dark: '#E08ABA' },
  'maternity-newborn': { light: '#DD2590', dark: '#EE92C8' },
  'product-photographer': { light: '#93370D', dark: '#C99B86' },
  'event-videographer': { light: '#475467', dark: '#A3AAB3' },
  'drone-operator': { light: '#0086C9', dark: '#80C3E4' },
  'photo-booth': { light: '#6941C6', dark: '#B4A0E3' },
  caterer: { light: '#B54708', dark: '#DAA384' },
  decorator: { light: '#DD2590', dark: '#EE92C8' },
  'bridal-makeup': { light: '#C11574', dark: '#E08ABA' },
  'mehendi-artist': { light: '#93370D', dark: '#C99B86' },
  dj: { light: '#444CE7', dark: '#A2A6F3' },
  'live-band': { light: '#B42318', dark: '#DA918C' },
  'wedding-planner': { light: '#067647', dark: '#83BBA3' },
  'demo-home-tutor': { light: '#1E5EFF', dark: '#8FAFFF' },
  instagram: { light: '#C11574', dark: '#E08ABA' },
  youtube: { light: '#D92D20', dark: '#EC9690' },
  video: { light: '#444CE7', dark: '#A2A6F3' },
  camera: { light: '#0E7090', dark: '#87B8C8' },
  restaurant: { light: '#B54708', dark: '#DAA384' },
  sparkles: { light: '#DD2590', dark: '#EE92C8' },
  beauty: { light: '#C11574', dark: '#E08ABA' },
  'hand-left': { light: '#93370D', dark: '#C99B86' },
  music: { light: '#444CE7', dark: '#A2A6F3' },
  briefcase: { light: '#067647', dark: '#83BBA3' },
  school: { light: '#1E5EFF', dark: '#8FAFFF' },
} as const;

/** 4-pt scale. Screen gutter 16, card padding 16, sibling cards 12, sections 28. */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  section: 28,
  xxxl: 32,
  huge: 40,
  giant: 48,
} as const;

/** xs: status badges · sm: inner panels · md: buttons/inputs · lg: cards · xl: sheets/hero · pill: chips/avatars. */
export const radii = {
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 24,
  pill: 999,
} as const;

export const iconSize = { xs: 14, sm: 16, md: 20, lg: 24, xl: 28 } as const;

/** Minimum touch target (Apple HIG 44pt, Material 48dp — we use 48). */
export const minTouch = 48;

export const fontFamily = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  /** 800 is no longer loaded; kept as an alias so the wordmark still resolves. */
  extrabold: 'Inter_700Bold',
} as const;

export type TypographyVariant =
  | 'largeTitle'
  | 'display'
  | 'title1'
  | 'title2'
  | 'title3'
  | 'body'
  | 'bodyStrong'
  | 'callout'
  | 'calloutStrong'
  | 'subhead'
  | 'subheadStrong'
  | 'footnote'
  | 'footnoteStrong'
  | 'caption'
  | 'captionStrong'
  | 'overline'
  | 'micro'
  | 'button'
  | 'numeric';

/** Modelled on iOS Dynamic Type ("Large") and M3 Body Large; Inter reads ~1pt larger than SF so body is 16/24. */
export const typography: Record<TypographyVariant, TextStyle> = {
  largeTitle: { fontFamily: fontFamily.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.5 },
  display: { fontFamily: fontFamily.bold, fontSize: 32, lineHeight: 40, letterSpacing: -0.6 },
  title1: { fontFamily: fontFamily.bold, fontSize: 24, lineHeight: 30, letterSpacing: -0.3 },
  title2: { fontFamily: fontFamily.semibold, fontSize: 20, lineHeight: 26, letterSpacing: -0.2 },
  title3: { fontFamily: fontFamily.semibold, fontSize: 17, lineHeight: 22, letterSpacing: -0.1 },
  body: { fontFamily: fontFamily.regular, fontSize: 16, lineHeight: 24 },
  bodyStrong: { fontFamily: fontFamily.semibold, fontSize: 16, lineHeight: 24 },
  callout: { fontFamily: fontFamily.regular, fontSize: 15, lineHeight: 20 },
  calloutStrong: { fontFamily: fontFamily.semibold, fontSize: 15, lineHeight: 20 },
  subhead: { fontFamily: fontFamily.medium, fontSize: 14, lineHeight: 20 },
  subheadStrong: { fontFamily: fontFamily.semibold, fontSize: 14, lineHeight: 20 },
  footnote: { fontFamily: fontFamily.regular, fontSize: 13, lineHeight: 18 },
  footnoteStrong: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fontFamily.medium, fontSize: 12, lineHeight: 16 },
  captionStrong: { fontFamily: fontFamily.semibold, fontSize: 12, lineHeight: 16 },
  overline: { fontFamily: fontFamily.semibold, fontSize: 11, lineHeight: 16, letterSpacing: 0.4, textTransform: 'uppercase' },
  micro: { fontFamily: fontFamily.semibold, fontSize: 11, lineHeight: 14 },
  button: { fontFamily: fontFamily.semibold, fontSize: 16, lineHeight: 20 },
  numeric: { fontFamily: fontFamily.bold, fontSize: 28, lineHeight: 34, letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
};

/** Dynamic Type caps per variant: body copy scales furthest, titles and badges less so layouts hold. */
export const maxFontScale: Record<TypographyVariant, number> = {
  largeTitle: 1.3,
  display: 1.3,
  title1: 1.3,
  title2: 1.3,
  title3: 1.4,
  body: 1.6,
  bodyStrong: 1.6,
  callout: 1.6,
  calloutStrong: 1.6,
  subhead: 1.5,
  subheadStrong: 1.5,
  footnote: 1.6,
  footnoteStrong: 1.6,
  caption: 1.2,
  captionStrong: 1.2,
  overline: 1.2,
  micro: 1.2,
  button: 1.3,
  numeric: 1.3,
};

export const motion = {
  fast: 150,
  base: 220,
  slow: 320,
  spring: { damping: 22, stiffness: 240, mass: 0.9 },
  easing: {
    standard: Easing.bezier(0.2, 0, 0, 1),
    exit: Easing.bezier(0.3, 0, 1, 1),
  },
} as const;

export type Elevation = 'none' | 'sm' | 'md' | 'lg' | 'footer';

/**
 * Light: soft layered shadows (e1 = sm resting, e2 = md raised, e3 = lg sheets/toasts, footer = upward).
 * Dark: no shadows — elevation is expressed by surface tone + a 1px border.
 */
export function shadows(dark: boolean): Record<Elevation, { boxShadow?: string }> {
  if (dark) return { none: {}, sm: {}, md: {}, lg: {}, footer: {} };
  return {
    none: {},
    sm: { boxShadow: '0px 1px 2px rgba(16,24,40,0.05)' },
    md: { boxShadow: '0px 4px 8px -2px rgba(16,24,40,0.08), 0px 2px 4px -2px rgba(16,24,40,0.04)' },
    lg: { boxShadow: '0px 12px 24px -4px rgba(16,24,40,0.12), 0px 4px 8px -2px rgba(16,24,40,0.05)' },
    footer: { boxShadow: '0px -4px 12px rgba(16,24,40,0.06)' },
  };
}