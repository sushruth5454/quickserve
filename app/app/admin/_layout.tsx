import { Redirect, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { FullScreenLoader } from '../../src/components/ui';
import { amIAdmin } from '../../src/lib/adminApi';

export default function AdminLayout() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    void amIAdmin().then(setAllowed).catch(() => setAllowed(false));
  }, []);
  if (allowed === null) return <FullScreenLoader />;
  if (!allowed) return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />;
}
