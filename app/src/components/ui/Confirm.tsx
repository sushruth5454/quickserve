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
          <View style={{ alignItems: 'center', gap: t.spacing.md, paddingTop: t.spacing.sm }}>
            <View
              style={{
                width: 60,
                height: 60,
                borderRadius: 30,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: opts.destructive ? t.colors.dangerSoft : t.colors.primarySoft,
              }}
            >
              <Ionicons
                name={opts.icon ?? (opts.destructive ? 'warning-outline' : 'help-circle-outline')}
                size={28}
                color={opts.destructive ? t.colors.danger : t.colors.primary}
              />
            </View>
            <Text variant="title2" align="center" accessibilityRole="header">
              {opts.title}
            </Text>
            {opts.message ? (
              <Text variant="body" color="muted" align="center">
                {opts.message}
              </Text>
            ) : null}
            <View style={{ alignSelf: 'stretch', gap: t.spacing.sm, marginTop: t.spacing.sm }}>
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
