import { router } from 'expo-router';
import type { ComponentRef, ReactNode, Ref } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { IconButton } from './IconButton';
import { Text } from './Text';

interface ScreenProps {
  children: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  padded?: boolean;
  gap?: number;
  /** Tab roots: the tab bar already handles the bottom inset. */
  inTabs?: boolean;
  /** Apply the top safe-area inset when there is no Header. */
  safeTop?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  stickyHeaderIndices?: number[];
  scrollProps?: Partial<ScrollViewProps>;
  scrollRef?: Ref<ComponentRef<typeof ScrollView>>;
  background?: string;
}

export function Screen({
  children,
  header,
  footer,
  scroll = true,
  refreshing,
  onRefresh,
  padded = true,
  gap,
  inTabs,
  safeTop,
  contentStyle,
  stickyHeaderIndices,
  scrollProps,
  scrollRef,
  background,
}: ScreenProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad = footer ? t.spacing.xl : inTabs ? t.spacing.xxl : Math.max(insets.bottom, t.spacing.lg) + t.spacing.xl;
  const content: StyleProp<ViewStyle> = [
    { gap: gap ?? t.spacing.lg, paddingBottom: bottomPad },
    padded && { paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.lg },
    safeTop && !header && { paddingTop: insets.top + (padded ? t.spacing.lg : 0) },
    contentStyle,
  ];
  return (
    <View style={[styles.root, { backgroundColor: background ?? t.colors.bg }]}>
      {header}
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {scroll ? (
          <ScrollView
            ref={scrollRef}
            style={styles.root}
            contentContainerStyle={content}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            stickyHeaderIndices={stickyHeaderIndices}
            showsVerticalScrollIndicator={false}
            refreshControl={
              onRefresh ? (
                <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={t.colors.primary} colors={[t.colors.primary]} />
              ) : undefined
            }
            {...scrollProps}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.root, content]}>{children}</View>
        )}
        {footer ? <StickyFooter inTabs={inTabs}>{footer}</StickyFooter> : null}
      </KeyboardAvoidingView>
    </View>
  );
}

export function StickyFooter({ children, inTabs }: { children: ReactNode; inTabs?: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        {
          paddingHorizontal: t.spacing.lg,
          paddingTop: t.spacing.md,
          paddingBottom: inTabs ? t.spacing.md : Math.max(insets.bottom, t.spacing.md),
          backgroundColor: t.colors.surface,
          borderTopWidth: 1,
          borderTopColor: t.colors.border,
          gap: t.spacing.sm,
        },
        t.shadows.md,
      ]}
    >
      {children}
    </View>
  );
}

interface HeaderProps {
  title?: string;
  subtitle?: string;
  back?: boolean;
  onBack?: () => void;
  right?: ReactNode;
  large?: boolean;
  transparent?: boolean;
  children?: ReactNode;
}

export function Header({ title, subtitle, back = true, onBack, right, large, transparent, children }: HeaderProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const goBack = () => {
    if (onBack) return onBack();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  return (
    <View
      style={{
        paddingTop: insets.top + (large ? t.spacing.sm : 0),
        backgroundColor: 'transparent',
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: large ? 60 : 56,
          paddingHorizontal: large ? t.spacing.lg : t.spacing.xs,
          gap: t.spacing.xs,
        }}
      >
        {back && !large ? <IconButton icon="chevron-back" accessibilityLabel="Go back" onPress={goBack} /> : null}
        <View style={{ flex: 1, paddingHorizontal: back && !large ? 0 : t.spacing.xs }}>
          {title ? (
            <Text variant={large ? 'title1' : 'title3'} accessibilityRole="header" numberOfLines={1}>
              {title}
            </Text>
          ) : null}
          {subtitle ? (
            <Text variant="caption" color="muted" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right ? <View style={{ flexDirection: 'row', alignItems: 'center', paddingRight: large ? 0 : t.spacing.md }}>{right}</View> : null}
      </View>
      {children}
    </View>
  );
}

export function Section({
  title,
  action,
  children,
  subtitle,
  gap,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  gap?: number;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: gap ?? t.spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Text variant="title3" accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? (
            <Text variant="caption" color="muted">
              {subtitle}
            </Text>
          ) : null}
        </View>
        {action}
      </View>
      {children}
    </View>
  );
}

export function FullScreenLoader() {
  const t = useTheme();
  return (
    <View style={[styles.root, { alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.bg }]}>
      <ActivityIndicator size="large" color={t.colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
