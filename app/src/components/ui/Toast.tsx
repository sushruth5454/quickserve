import { Ionicons } from '@expo/vector-icons';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInUp, FadeOutDown, LinearTransition } from 'react-native-reanimated';
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

export function useToast() {
  return useContext(ToastContext);
}

const ICONS: Record<ToastTone, IconName> = {
  default: 'information-circle',
  success: 'checkmark-circle',
  error: 'alert-circle',
  warning: 'warning',
};

/** Snackbar-style toasts shown above the tab bar / home indicator. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<ToastItem[]>([]);
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
    () => ({ default: t.colors.primary, success: t.colors.success, error: t.colors.danger, warning: t.colors.warning }),
    [t],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end' }]}>
        <View pointerEvents="box-none" style={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 72, gap: 8 }}>
          {items.map((item) => {
            const tone = item.tone ?? 'default';
            return (
              <Animated.View
                key={item.id}
                entering={FadeInUp.springify().damping(18)}
                exiting={FadeOutDown.duration(180)}
                layout={LinearTransition}
                accessibilityLiveRegion="polite"
                accessibilityRole="alert"
                style={[
                  {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    paddingVertical: 12,
                    paddingLeft: 14,
                    paddingRight: item.actionLabel ? 6 : 14,
                    borderRadius: t.radii.md,
                    backgroundColor: t.dark ? '#26324A' : '#101828',
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
                    <Text variant="subhead" style={{ color: '#8FB0FF' }}>
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
  );
}
