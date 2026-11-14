import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useMemo, type ComponentProps } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { tabBarHeight } from './ui';

type TabOptions = Extract<NonNullable<ComponentProps<typeof Tabs>['screenOptions']>, object>;
type IonName = ComponentProps<typeof Ionicons>['name'];

export function useTabScreenOptions(): TabOptions {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const height = tabBarHeight(insets);
  return useMemo<TabOptions>(
    () => ({
      headerShown: false,
      tabBarActiveTintColor: t.colors.primaryText,
      tabBarInactiveTintColor: t.colors.muted,
      tabBarLabelStyle: { fontFamily: t.fontFamily.medium, fontSize: 11, lineHeight: 13 },
      tabBarItemStyle: { paddingTop: Platform.OS === 'android' ? 8 : 6 },
      tabBarStyle: {
        backgroundColor: t.colors.surface,
        borderTopColor: t.colors.borderStrong,
        borderTopWidth: StyleSheet.hairlineWidth,
        height,
        paddingBottom: insets.bottom + (Platform.OS === 'ios' ? 0 : 6),
      },
      sceneStyle: { backgroundColor: t.colors.bg },
      animation: 'fade',
    }),
    [t, height, insets.bottom],
  );
}

/** Tab icon: outline when idle, filled when selected; Android adds the M3 pill indicator behind the active icon. */
export function TabIcon({ name, activeName, focused, color }: { name: IonName; activeName: IonName; focused: boolean; color: string }) {
  const t = useTheme();
  const icon = <Ionicons name={focused ? activeName : name} size={24} color={color} />;
  if (Platform.OS !== 'android') return icon;
  return (
    <View
      style={{
        width: 56,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: focused ? t.colors.primarySoft : 'transparent',
      }}
    >
      {icon}
    </View>
  );
}
