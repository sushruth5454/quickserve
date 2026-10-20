import { Tabs } from 'expo-router';
import { useMemo, type ComponentProps } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';

type TabOptions = Extract<NonNullable<ComponentProps<typeof Tabs>['screenOptions']>, object>;

export function useTabScreenOptions(): TabOptions {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 8);
  return useMemo<TabOptions>(
    () => ({
      headerShown: false,
      tabBarActiveTintColor: t.colors.primary,
      tabBarInactiveTintColor: t.colors.muted,
      tabBarLabelStyle: { fontFamily: t.fontFamily.semibold, fontSize: 11.5, lineHeight: 15 },
      tabBarItemStyle: { paddingTop: 4 },
      tabBarStyle: {
        backgroundColor: t.colors.surface,
        borderTopColor: t.colors.border,
        borderTopWidth: 1,
        height: 58 + bottom,
        paddingBottom: bottom,
      },
      sceneStyle: { backgroundColor: t.colors.bg },
      animation: 'fade',
    }),
    [t, bottom],
  );
}
