export const colors = {
  primary: '#1E5EFF',
  primarySoft: '#E8EEFF',
  success: '#12B76A',
  successSoft: '#E7F8F0',
  warning: '#F79009',
  warningSoft: '#FEF4E6',
  danger: '#F04438',
  dangerSoft: '#FEECEB',
  text: '#101828',
  muted: '#667085',
  border: '#E4E7EC',
  bg: '#F8FAFC',
  surface: '#FFFFFF',
  white: '#FFFFFF',
} as const;

export const radius = 12;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const minTouch = 48;

export const font = {
  title: { fontSize: 22, fontWeight: '700' as const, color: colors.text },
  heading: { fontSize: 17, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 15, color: colors.text },
  caption: { fontSize: 13, color: colors.muted },
};
