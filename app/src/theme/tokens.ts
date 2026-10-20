import type { TextStyle } from 'react-native';

export interface Palette {
  primary: string;
  primaryPressed: string;
  primarySoft: string;
  onPrimary: string;
  success: string;
  successSoft: string;
  successText: string;
  warning: string;
  warningSoft: string;
  warningText: string;
  danger: string;
  dangerSoft: string;
  dangerText: string;
  info: string;
  infoSoft: string;
  text: string;
  textSecondary: string;
  muted: string;
  subtle: string;
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  borderStrong: string;
  star: string;
  overlay: string;
  skeleton: string;
  bubbleMine: string;
  bubbleTheirs: string;
  heroFrom: string;
  heroTo: string;
}

export const lightPalette: Palette = {
  primary: '#1E5EFF',
  primaryPressed: '#1849CC',
  primarySoft: '#EAF0FF',
  onPrimary: '#FFFFFF',
  success: '#12B76A',
  successSoft: '#E7F8F0',
  successText: '#067647',
  warning: '#F79009',
  warningSoft: '#FFF6E8',
  warningText: '#B54708',
  danger: '#F04438',
  dangerSoft: '#FEECEB',
  dangerText: '#B42318',
  info: '#0BA5EC',
  infoSoft: '#E6F6FE',
  text: '#101828',
  textSecondary: '#344054',
  muted: '#667085',
  subtle: '#98A2B3',
  bg: '#F6F8FB',
  surface: '#FFFFFF',
  surfaceAlt: '#F2F4F7',
  border: '#EAECF0',
  borderStrong: '#D0D5DD',
  star: '#FDB022',
  overlay: 'rgba(16,24,40,0.45)',
  skeleton: '#E9ECF1',
  bubbleMine: '#1E5EFF',
  bubbleTheirs: '#F2F4F7',
  heroFrom: '#1E5EFF',
  heroTo: '#5B8CFF',
};

export const darkPalette: Palette = {
  primary: '#3D74FF',
  primaryPressed: '#2C5FE6',
  primarySoft: '#17244A',
  onPrimary: '#FFFFFF',
  success: '#32D583',
  successSoft: '#0E2C20',
  successText: '#6CE9A6',
  warning: '#FDB022',
  warningSoft: '#33250B',
  warningText: '#FEC84B',
  danger: '#F97066',
  dangerSoft: '#3A1513',
  dangerText: '#FDA29B',
  info: '#36BFFA',
  infoSoft: '#0B2B3D',
  text: '#F5F7FA',
  textSecondary: '#D0D5DD',
  muted: '#98A2B3',
  subtle: '#667085',
  bg: '#0B111C',
  surface: '#131B29',
  surfaceAlt: '#1B2434',
  border: '#232E42',
  borderStrong: '#344054',
  star: '#FDB022',
  overlay: 'rgba(0,0,0,0.6)',
  skeleton: '#1E283A',
  bubbleMine: '#3D74FF',
  bubbleTheirs: '#1B2434',
  heroFrom: '#1A3FB8',
  heroTo: '#3D6BF0',
};

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
} as const;

export const radii = {
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  pill: 999,
} as const;

/** Minimum touch target (Apple HIG 44pt, Material 48dp — we use 48). */
export const minTouch = 48;

export const fontFamily = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extrabold: 'Inter_800ExtraBold',
} as const;

export type TypographyVariant =
  | 'display'
  | 'title1'
  | 'title2'
  | 'title3'
  | 'body'
  | 'bodyStrong'
  | 'callout'
  | 'subhead'
  | 'caption'
  | 'captionStrong'
  | 'micro'
  | 'button'
  | 'numeric';

export const typography: Record<TypographyVariant, TextStyle> = {
  display: { fontFamily: fontFamily.extrabold, fontSize: 30, lineHeight: 36, letterSpacing: -0.6 },
  title1: { fontFamily: fontFamily.bold, fontSize: 24, lineHeight: 30, letterSpacing: -0.4 },
  title2: { fontFamily: fontFamily.bold, fontSize: 20, lineHeight: 26, letterSpacing: -0.3 },
  title3: { fontFamily: fontFamily.semibold, fontSize: 17, lineHeight: 24, letterSpacing: -0.2 },
  body: { fontFamily: fontFamily.regular, fontSize: 15, lineHeight: 22 },
  bodyStrong: { fontFamily: fontFamily.semibold, fontSize: 15, lineHeight: 22 },
  callout: { fontFamily: fontFamily.medium, fontSize: 14, lineHeight: 20 },
  subhead: { fontFamily: fontFamily.semibold, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: fontFamily.medium, fontSize: 13, lineHeight: 18 },
  captionStrong: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 18 },
  micro: { fontFamily: fontFamily.semibold, fontSize: 11, lineHeight: 14, letterSpacing: 0.4 },
  button: { fontFamily: fontFamily.semibold, fontSize: 16, lineHeight: 20 },
  numeric: { fontFamily: fontFamily.bold, fontSize: 28, lineHeight: 34, letterSpacing: -0.5 },
};

export const motion = {
  fast: 150,
  base: 220,
  slow: 320,
  spring: { damping: 22, stiffness: 240, mass: 0.9 },
} as const;

export type Elevation = 'none' | 'sm' | 'md' | 'lg';

/** Cross-platform shadows via the `boxShadow` style (New Architecture + react-native-web). */
export function shadows(dark: boolean): Record<Elevation, { boxShadow?: string }> {
  const a = dark ? 0.6 : 1;
  return {
    none: {},
    sm: { boxShadow: `0px 1px 2px rgba(16,24,40,${(0.06 * a).toFixed(3)})` },
    md: {
      boxShadow: `0px 4px 12px rgba(16,24,40,${(0.07 * a).toFixed(3)}), 0px 1px 2px rgba(16,24,40,${(0.05 * a).toFixed(3)})`,
    },
    lg: {
      boxShadow: `0px 12px 28px rgba(16,24,40,${(0.14 * a).toFixed(3)}), 0px 4px 8px rgba(16,24,40,${(0.06 * a).toFixed(3)})`,
    },
  };
}
