import { Redirect, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  accessError,
  accessForActor,
  adminAccessResult,
  loadingAccess,
  retryAccess,
  type AccessPresentation,
} from '../../src/lib/accessPresentation';
import { useAuth } from '../../src/lib/auth';
import { Button, FullScreenLoader, InlineAlert, Screen } from '../../src/components/ui';
import { amIAdmin } from '../../src/lib/adminApi';
import { useNavigationIdentityOptions } from '../../src/components/tabOptions';

export default function AdminLayout() {
  const { userId, loading: authLoading } = useAuth();
  const identityOptions = useNavigationIdentityOptions('account');
  const [access, setAccess] = useState<AccessPresentation<never>>(() => loadingAccess(null));
  const [accessAttempt, setAccessAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setAccess(loadingAccess(userId));
    if (authLoading) return () => { active = false; };
    void amIAdmin()
      .then((allowed) => {
        if (typeof allowed !== 'boolean') throw new Error('Admin access check returned an invalid response.');
        if (active) setAccess(adminAccessResult(userId, allowed));
      })
      .catch((error: unknown) => {
        if (active) setAccess(accessError(userId, error, 'Unable to verify admin access.'));
      });
    return () => { active = false; };
  }, [accessAttempt, authLoading, userId]);
  const currentAccess = accessForActor(access, userId);
  if (authLoading || currentAccess.status === 'loading') return <FullScreenLoader />;
  if (currentAccess.status === 'error') {
    return (
      <Screen>
        <InlineAlert message={currentAccess.message} />
        <Button
          title="Retry"
          onPress={() => {
            setAccess((previous) => retryAccess(previous, userId));
            setAccessAttempt((attempt) => attempt + 1);
          }}
        />
      </Screen>
    );
  }
  if (currentAccess.status === 'denied') return <Redirect href="/" />;
  if (currentAccess.status !== 'allowed') return <FullScreenLoader />;
  return <Stack screenOptions={{ ...identityOptions, animation: 'slide_from_right' }} />;
}
