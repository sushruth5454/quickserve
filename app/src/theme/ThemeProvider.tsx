import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { StyleSheet, useColorScheme, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';
import { useAppearance } from '../branding/AppearanceProvider';
import {
  darkPalette,
  fontFamily,
  iconSize,
  lightPalette,
  minTouch,
  motion,
  radii,
  shadows,
  spacing,
  typography,
  type Palette,
} from './tokens';
import type { BrandingV1 } from '../branding/types';

export interface Theme {
  dark: boolean;
  colors: Palette;
  spacing: typeof spacing;
  radii: typeof radii;
  typography: typeof typography;
  fontFamily: typeof fontFamily;
  shadows: ReturnType<typeof shadows>;
  iconSize: typeof iconSize;
  motion: typeof motion;
  minTouch: number;
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

export function resolveDarkTheme(
  scheme: 'light' | 'dark' | null,
  appearance: BrandingV1 | null,
): boolean {
  if (scheme === 'dark') return true;
  if (scheme === 'light') return false;
  return appearance?.defaultTheme === 'dark';
}

export function createThemeSnapshot(
  dark: boolean,
  appearance: BrandingV1 | null,
  manropeReady: boolean,
): Theme {
  const colors: Palette = {
    ...(dark ? darkPalette : lightPalette),
    ...(appearance ? (dark ? appearance.dark : appearance.light) : {}),
  };
  const useManrope = appearance?.headingFont === 'manrope' && manropeReady;
  const themedTypography = useManrope
    ? {
        ...typography,
        largeTitle: { ...typography.largeTitle, fontFamily: 'Manrope_700Bold' },
        display: { ...typography.display, fontFamily: 'Manrope_700Bold' },
        title1: { ...typography.title1, fontFamily: 'Manrope_700Bold' },
        title2: { ...typography.title2, fontFamily: 'Manrope_600SemiBold' },
        title3: { ...typography.title3, fontFamily: 'Manrope_600SemiBold' },
      }
    : typography;

  return freezeDeep({
    dark,
    colors,
    spacing,
    radii,
    typography: themedTypography,
    fontFamily,
    shadows: shadows(dark),
    iconSize,
    motion,
    minTouch,
  });
}

const lightTheme = createThemeSnapshot(false, null, false);
const darkTheme = createThemeSnapshot(true, null, false);

const ThemeContext = createContext<Theme>(lightTheme);

export function ThemeProvider({
  children,
  manropeReady = false,
}: {
  children: ReactNode;
  manropeReady?: boolean;
}) {
  const scheme = useColorScheme();
  const { config } = useAppearance();
  const dark = resolveDarkTheme(scheme, config);
  const useManrope = config?.headingFont === 'manrope' && manropeReady;
  const theme = useMemo(() => {
    if (!config && !useManrope) return dark ? darkTheme : lightTheme;
    return createThemeSnapshot(dark, config, useManrope);
  }, [dark, config, useManrope]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

/**
 * Creates a themed style hook. Styles are computed once per immutable theme identity and cached.
 *   const useStyles = makeStyles((t) => ({ root: { backgroundColor: t.colors.bg } }));
 */
export function makeStyles<T extends NamedStyles<T>>(factory: (t: Theme) => T) {
  const cache = new WeakMap<Theme, T>();
  return function useStyles(): T {
    const theme = useTheme();
    return useMemo(() => {
      const hit = cache.get(theme);
      if (hit) return hit;
      const created = StyleSheet.create(factory(theme)) as T;
      cache.set(theme, created);
      return created;
    }, [theme]);
  };
}
