import type { ReactNode } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Button, Text } from './ui';
import { useT } from '../i18n';
import { useAuth } from '../lib/auth';
import { safeReturnTo } from '../lib/authGate';
import { useTheme } from '../theme';

export function shouldRenderPrivate(session: unknown): boolean {
  return session !== null && session !== undefined;
}

export function GuestGate({ children, returnTo }: { children?: ReactNode; returnTo: string }) {
  const { session } = useAuth();
  const t = useTheme();
  const translate = useT();
  if (shouldRenderPrivate(session)) return <>{children}</>;

  const signIn = () => {
    const path = safeReturnTo(returnTo) ? returnTo : undefined;
    router.push(path ? { pathname: '/login', params: { returnTo: path } } : '/login');
  };
  const prompt = translate('guest.signInToContinue');

  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        gap: t.spacing.md,
        padding: t.spacing.xl,
        backgroundColor: t.colors.bg,
      }}
    >
      <Text variant="body" align="center">
        {prompt}
      </Text>
      <Button title={prompt} onPress={signIn} fullWidth />
    </View>
  );
}
