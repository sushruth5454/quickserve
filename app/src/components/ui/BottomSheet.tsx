import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { useTheme } from '../../theme';
import { IconButton } from './IconButton';
import { Text } from './Text';

interface Props {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Max height as a fraction of the window height. */
  maxHeight?: number;
}

/** Modal bottom sheet: slides up with a spring, drag the handle/header down (or tap the backdrop) to dismiss. */
export function BottomSheet({ visible, onClose, title, subtitle, children, footer, maxHeight = 0.88 }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const translateY = useSharedValue(height);
  const backdrop = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      translateY.value = height;
      translateY.value = withSpring(0, { damping: 26, stiffness: 260, mass: 0.9 });
      backdrop.value = withTiming(1, { duration: t.motion.base });
    } else if (mounted) {
      backdrop.value = withTiming(0, { duration: t.motion.fast });
      translateY.value = withTiming(height, { duration: t.motion.base, easing: Easing.in(Easing.cubic) }, (done) => {
        if (done) scheduleOnRN(setMounted, false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      translateY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 120 || e.velocityY > 900) {
        scheduleOnRN(onClose);
      } else {
        translateY.value = withSpring(0, { damping: 26, stiffness: 260 });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));

  if (!mounted) return null;
  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <GestureHandlerRootView style={styles.flex}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: t.colors.overlay }, backdropStyle]}>
          <Pressable style={styles.flex} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close sheet" />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              maxHeight: height * maxHeight,
              backgroundColor: t.colors.surface,
              borderTopLeftRadius: t.radii.xxl,
              borderTopRightRadius: t.radii.xxl,
              paddingBottom: Math.max(insets.bottom, t.spacing.lg),
            },
            t.shadows.lg,
            sheetStyle,
          ]}
        >
          <GestureDetector gesture={pan}>
            <View style={{ paddingTop: t.spacing.sm }}>
              <View style={[styles.handle, { backgroundColor: t.colors.borderStrong }]} />
              {title ? (
                <View style={[styles.header, { paddingHorizontal: t.spacing.xl }]}>
                  <View style={styles.flex}>
                    <Text variant="title2" accessibilityRole="header">
                      {title}
                    </Text>
                    {subtitle ? (
                      <Text variant="caption" color="muted">
                        {subtitle}
                      </Text>
                    ) : null}
                  </View>
                  <IconButton icon="close" accessibilityLabel="Close" onPress={onClose} variant="tonal" color="textSecondary" size={20} />
                </View>
              ) : null}
            </View>
          </GestureDetector>
          <ScrollView
            style={styles.body}
            contentContainerStyle={{ paddingHorizontal: t.spacing.xl, paddingBottom: t.spacing.lg, gap: t.spacing.lg }}
            keyboardShouldPersistTaps="handled"
            bounces={false}
          >
            {children}
          </ScrollView>
          {footer ? (
            <View
              style={{
                paddingHorizontal: t.spacing.xl,
                paddingTop: t.spacing.md,
                borderTopWidth: 1,
                borderTopColor: t.colors.border,
              }}
            >
              {footer}
            </View>
          ) : null}
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, marginBottom: 8 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 8 },
  body: { flexGrow: 0 },
});
