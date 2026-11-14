import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { createContext, useCallback, useContext, useRef, useState, type ComponentRef, type ReactNode, type Ref } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';
import { IconButton } from './IconButton';
import { Text } from './Text';
import { useToastOffset } from './Toast';

/** Bottom tab bar height incl. the home-indicator inset (iOS 49, Android 64 per M3, web 56). */
export function tabBarHeight(insets: EdgeInsets): number {
  const base = Platform.OS === 'ios' ? 49 : Platform.OS === 'android' ? 64 : 64;
  return base + insets.bottom;
}

const ScrollEdgeContext = createContext(false);

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
  /** Horizontal gutter for content and the sticky footer (16 default; auth screens use 24). */
  gutter?: number;
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
  gutter,
  contentStyle,
  stickyHeaderIndices,
  scrollProps,
  scrollRef,
  background,
}: ScreenProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const setToastOffset = useToastOffset();
  const [scrolled, setScrolled] = useState(false);
  const scrolledRef = useRef(false);
  const [footerHeight, setFooterHeight] = useState(0);
  const g = gutter ?? t.spacing.lg;

  const toastOffset = footer && footerHeight > 0 ? footerHeight + 8 : inTabs ? tabBarHeight(insets) + 8 : insets.bottom + 16;
  useFocusEffect(
    useCallback(() => {
      setToastOffset(toastOffset);
    }, [setToastOffset, toastOffset]),
  );

  const bottomPad = footer ? t.spacing.xxl : inTabs ? t.spacing.xxxl : Math.max(insets.bottom, t.spacing.lg) + t.spacing.xl;
  const content: StyleProp<ViewStyle> = [
    { gap: gap ?? t.spacing.xxl, paddingBottom: bottomPad },
    padded && { paddingHorizontal: g, paddingTop: t.spacing.lg },
    safeTop && !header && { paddingTop: insets.top + (padded ? t.spacing.lg : 0) },
    contentStyle,
  ];
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const s = e.nativeEvent.contentOffset.y > 4;
    if (s !== scrolledRef.current) {
      scrolledRef.current = s;
      setScrolled(s);
    }
    scrollProps?.onScroll?.(e);
  };
  return (
    <View style={[styles.root, { backgroundColor: background ?? t.colors.bg }]}>
      <ScrollEdgeContext.Provider value={scrolled}>{header}</ScrollEdgeContext.Provider>
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
            scrollEventThrottle={32}
            refreshControl={
              onRefresh ? (
                <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={t.colors.primary} colors={[t.colors.primary]} />
              ) : undefined
            }
            {...scrollProps}
            onScroll={onScroll}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.root, content]}>{children}</View>
        )}
        {footer ? (
          <StickyFooter inTabs={inTabs} gutter={g} onHeight={setFooterHeight}>
            {footer}
          </StickyFooter>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

export function StickyFooter({
  children,
  inTabs,
  gutter,
  onHeight,
}: {
  children: ReactNode;
  inTabs?: boolean;
  gutter?: number;
  onHeight?: (h: number) => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      onLayout={onHeight ? (e) => onHeight(Math.round(e.nativeEvent.layout.height)) : undefined}
      style={[
        {
          paddingHorizontal: gutter ?? t.spacing.lg,
          paddingTop: t.spacing.md,
          paddingBottom: inTabs ? t.spacing.md : Math.max(insets.bottom, t.spacing.md),
          backgroundColor: t.colors.surface,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: t.colors.borderStrong,
          gap: t.spacing.sm,
        },
        t.shadows.footer,
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
  const scrolled = useContext(ScrollEdgeContext);
  const goBack = () => {
    if (onBack) return onBack();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  return (
    <View
      style={{
        paddingTop: insets.top + (large ? t.spacing.sm : 0),
        backgroundColor: transparent ? 'transparent' : t.colors.bg,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: scrolled && !transparent ? t.colors.borderStrong : 'transparent',
        zIndex: 1,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: large ? 56 : 52,
          paddingHorizontal: large ? t.spacing.lg : t.spacing.xs,
          gap: t.spacing.xs,
        }}
      >
        {back && !large ? <IconButton icon="chevron-back" accessibilityLabel="Go back" onPress={goBack} size={24} /> : null}
        <View style={{ flex: 1, paddingHorizontal: back && !large ? 0 : 0 }}>
          {title ? (
            <Text variant={large ? 'largeTitle' : 'title3'} accessibilityRole="header" numberOfLines={1}>
              {title}
            </Text>
          ) : null}
          {subtitle ? (
            <Text variant="footnote" color="muted" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.xs, paddingRight: large ? 0 : t.spacing.md }}>{right}</View>
        ) : null}
      </View>
      {children}
    </View>
  );
}

export function Section({
  title,
  action,
  actionLabel,
  onAction,
  children,
  subtitle,
  gap,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  /** Convenience "See all ›" style link on the right. */
  actionLabel?: string;
  onAction?: () => void;
  children: ReactNode;
  gap?: number;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: gap ?? t.spacing.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.sm }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="title3" accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? (
            <Text variant="footnote" color="muted">
              {subtitle}
            </Text>
          ) : null}
        </View>
        {action}
        {actionLabel && onAction ? (
          <Pressable
            accessibilityRole="button"
            onPress={onAction}
            hitSlop={8}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 32, opacity: pressed ? 0.6 : 1 })}
          >
            <Text variant="subheadStrong" color="primaryText">
              {actionLabel}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={t.colors.primaryText} />
          </Pressable>
        ) : null}
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
