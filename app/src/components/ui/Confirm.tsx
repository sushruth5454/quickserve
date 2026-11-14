import { Ionicons } from '@expo/vector-icons';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme';
import { BottomSheet } from './BottomSheet';
import { Button, type IconName } from './Button';
import { Text } from './Text';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  icon?: IconName;
}

const ConfirmContext = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);

export function useConfirm() {
  return useContext(ConfirmContext);
}

/** Promise-based confirmation sheet; works the same on iOS, Android and web (unlike Alert with buttons). */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const t = useTheme();
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [visible, setVisible] = useState(false);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    resolver.current?.(false);
    setOpts(o);
    setVisible(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const finish = (v: boolean) => {
    setVisible(false);
    resolver.current?.(v);
    resolver.current = null;
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <BottomSheet visible={visible} onClose={() => finish(false)}>
        {opts ? (
          <View style={{ alignItems: 'center', gap: t.spacing.sm, paddingTop: t.spacing.xs }}>
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: opts.destructive ? t.colors.dangerSoft : t.colors.surfaceAlt,
                marginBottom: t.spacing.xs,
              }}
            >
              <Ionicons
                name={opts.icon ?? (opts.destructive ? 'warning-outline' : 'help-circle-outline')}
                size={24}
                color={opts.destructive ? t.colors.dangerText : t.colors.textSecondary}
              />
            </View>
            <Text variant="title3" align="center" accessibilityRole="header">
              {opts.title}
            </Text>
            {opts.message ? (
              <Text variant="callout" color="muted" align="center" style={{ maxWidth: 340 }}>
                {opts.message}
              </Text>
            ) : null}
            <View style={{ alignSelf: 'stretch', gap: t.spacing.xs, marginTop: t.spacing.md }}>
              <Button
                title={opts.confirmLabel ?? 'Confirm'}
                variant={opts.destructive ? 'destructive' : 'primary'}
                onPress={() => finish(true)}
                fullWidth
              />
              <Button title={opts.cancelLabel ?? 'Not now'} variant="ghost" onPress={() => finish(false)} fullWidth />
            </View>
          </View>
        ) : null}
      </BottomSheet>
    </ConfirmContext.Provider>
  );
}
