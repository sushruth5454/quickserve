import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import {
  darkPalette,
  fontFamily,
  lightPalette,
  minTouch,
  motion,
  radii,
  shadows,
  spacing,
  typography,
  type Palette,
} from './tokens';

export interface Theme {
  dark: boolean;
  colors: Palette;
  spacing: typeof spacing;
  radii: typeof radii;
  typography: typeof typography;
  fontFamily: typeof fontFamily;
  shadows: ReturnType<typeof shadows>;
  motion: typeof motion;
  minTouch: number;
}

function buildTheme(dark: boolean): Theme {
  return {
    dark,
    colors: dark ? darkPalette : lightPalette,
    spacing,
    radii,
    typography,
    fontFamily,
    shadows: shadows(dark),
    motion,
    minTouch,
  };
}

const lightTheme = buildTheme(false);
const darkTheme = buildTheme(true);

const ThemeContext = createContext<Theme>(lightTheme);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const theme = scheme === 'dark' ? darkTheme : lightTheme;
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/**
 * Creates a themed style hook. Styles are computed once per theme (light/dark) and cached.
 *   const useStyles = makeStyles((t) => ({ root: { backgroundColor: t.colors.bg } }));
 */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(factory: (t: Theme) => T) {
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
