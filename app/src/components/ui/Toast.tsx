import { Ionicons } from '@expo/vector-icons';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInUp, FadeOut, FadeOutDown, LinearTransition, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { haptics } from '../../lib/haptics';
import { useTheme } from '../../theme';
import type { IconName } from './Button';
import { Text } from './Text';

type ToastTone = 'default' | 'success' | 'error' | 'warning';

interface ToastOptions {
  message: string;
  tone?: ToastTone;
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
  durationMs?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
}

const ToastContext = createContext<(o: ToastOptions | string) => void>(() => undefined);
/** Lets the focused screen tell toasts how far above the bottom edge to sit (tab bar / sticky footer). */
const ToastOffsetContext = createContext<(offset: number | null) => void>(() => undefined);

export function useToast() {
  return useContext(ToastContext);
}

export function useToastOffset() {
  return useContext(ToastOffsetContext);
}

const ICONS: Record<ToastTone, IconName> = {
  default: 'information-circle',
  success: 'checkmark-circle',
  error: 'alert-circle',
  warning: 'warning',
};

/** Snackbar-style toasts shown above the tab bar, sticky footer or home indicator. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [items, setItems] = useState<ToastItem[]>([]);
  const [offset, setOffset] = useState<number | null>(null);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);

  const show = useCallback(
    (o: ToastOptions | string) => {
      const opts: ToastOptions = typeof o === 'string' ? { message: o } : o;
      const id = ++seq.current;
      if (opts.tone === 'success') haptics.success();
      else if (opts.tone === 'error') haptics.error();
      setItems((xs) => [...xs.slice(-2), { ...opts, id }]);
      setTimeout(() => dismiss(id), opts.durationMs ?? 3200);
    },
    [dismiss],
  );

  const accent = useMemo(
    () => ({ default: '#8FB0FF', success: '#32D583', error: '#F97066', warning: '#FDB022' }),
    [],
  );

  return (
    <ToastOffsetContext.Provider value={setOffset}>
      <ToastContext.Provider value={show}>
        {children}
        <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end' }]}>
          <View
            pointerEvents="box-none"
            style={{ paddingHorizontal: 16, paddingBottom: offset ?? insets.bottom + 16, gap: 8, alignItems: 'center' }}
          >
            {items.map((item) => {
              const tone = item.tone ?? 'default';
              return (
                <Animated.View
                  key={item.id}
                  entering={reduceMotion ? FadeIn.duration(120) : FadeInUp.springify().damping(18)}
                  exiting={reduceMotion ? FadeOut.duration(120) : FadeOutDown.duration(180)}
                  layout={LinearTransition}
                  accessibilityLiveRegion="polite"
                  accessibilityRole="alert"
                  style={[
                    {
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      width: '100%',
                      maxWidth: 560,
                      minHeight: 48,
                      paddingVertical: 12,
                      paddingLeft: 14,
                      paddingRight: item.actionLabel ? 6 : 14,
                      borderRadius: t.radii.md,
                      backgroundColor: t.colors.toastBg,
                      borderWidth: 1,
                      borderColor: t.colors.toastBorder,
                    },
                    t.shadows.lg,
                  ]}
                >
                  <Ionicons name={item.icon ?? ICONS[tone]} size={20} color={accent[tone]} />
                  <Text variant="callout" style={{ color: '#FFFFFF', flex: 1 }}>
                    {item.message}
                  </Text>
                  {item.actionLabel ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        item.onAction?.();
                        dismiss(item.id);
                      }}
                      style={{ minHeight: 40, paddingHorizontal: 10, justifyContent: 'center' }}
                    >
                      <Text variant="subheadStrong" style={{ color: '#8FB0FF' }}>
                        {item.actionLabel}
                      </Text>
                    </Pressable>
                  ) : null}
                </Animated.View>
              );
            })}
          </View>
        </View>
      </ToastContext.Provider>
    </ToastOffsetContext.Provider>
  );
}
