import { Redirect, Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import { useAuth } from '../../src/lib/auth';
import { supabase } from '../../src/lib/supabase';
import {
  accessError,
  accessForActor,
  loadingAccess,
  resolvedAccess,
  retryAccess,
  type AccessPresentation,
} from '../../src/lib/accessPresentation';
import { badgeLabel } from '../../src/lib/unread';
import { useUnread } from '../../src/lib/unreadContext';
import { Button, FullScreenLoader, InlineAlert, Screen } from '../../src/components/ui';
import { ownerOnlyTabHref, TabIcon, useTabScreenOptions, useUnreadCountBadgeStyle } from '../../src/components/tabOptions';

export const unstable_settings = { initialRouteName: 'dashboard' };

export default function ProviderTabs() {
  const { activeRole, userId, loading: authLoading } = useAuth();
  const [access, setAccess] = useState<AccessPresentation<string | null>>(() => loadingAccess(null));
  const [accessAttempt, setAccessAttempt] = useState(0);
  const screenOptions = useTabScreenOptions('providerShare');
  const unreadBadgeStyle = useUnreadCountBadgeStyle();
  const unread = useUnread().total('provider');
  useEffect(() => {
    let active = true;
    setAccess(loadingAccess(userId));
    if (authLoading) return () => { active = false; };
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('get_provider_business_context');
        if (error) throw new Error(error.message);
        if (active) {
          setAccess(resolvedAccess(userId, (data as { business_role?: string } | null)?.business_role ?? null));
        }
      } catch (error) {
        if (active) setAccess(accessError<string | null>(userId, error, 'Unable to verify business access.'));
      }
    })();
    return () => { active = false; };
  }, [activeRole, accessAttempt, authLoading, userId]);
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
  if (currentAccess.status !== 'resolved') return <FullScreenLoader />;
  const businessRole = currentAccess.value;
  if (activeRole === 'customer' && !businessRole) return <Redirect href="/" />;
  const ownerTabHref = ownerOnlyTabHref(businessRole);
  return (
    <Tabs screenOptions={screenOptions}>
      <Tabs.Screen
        name="dashboard"
        options={{
          tabBarBadge: badgeLabel(unread),
          tabBarBadgeStyle: unreadBadgeStyle,
          title: 'Jobs',
          tabBarIcon: ({ color, focused }) => <TabIcon name="briefcase-outline" activeName="briefcase" focused={focused} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="earnings"
        options={{
          href: ownerTabHref,
          title: 'Earnings',
          tabBarIcon: ({ color, focused }) => <TabIcon name="wallet-outline" activeName="wallet" focused={focused} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="pro-account"
        options={{
          href: ownerTabHref,
          title: 'Me',
          tabBarIcon: ({ color, focused }) => <TabIcon name="person-circle-outline" activeName="person-circle" focused={focused} color={color as string} />,
        }}
      />
      <Tabs.Screen name="business-tools" options={{ href: null }} />
    </Tabs>
  );
}
