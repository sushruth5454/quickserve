import { Redirect, Tabs } from 'expo-router';
import { useEffect, useState } from 'react';
import { useAuth } from '../../src/lib/auth';
import { supabase } from '../../src/lib/supabase';
import { badgeLabel } from '../../src/lib/unread';
import { useUnread } from '../../src/lib/unreadContext';
import { useTheme } from '../../src/theme';
import { TabIcon, useTabScreenOptions } from '../../src/components/tabOptions';

export const unstable_settings = { initialRouteName: 'dashboard' };

export default function ProviderTabs() {
  const { activeRole } = useAuth();
  const [businessRole, setBusinessRole] = useState<string | null>(null);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const screenOptions = useTabScreenOptions();
  const t = useTheme();
  const unread = useUnread().total('provider');
  useEffect(() => {
    let active = true;
    setCheckingAccess(true);
    void supabase.rpc('get_provider_business_context').then(({ data }) => {
      if (!active) return;
      setBusinessRole((data as { business_role?: string } | null)?.business_role ?? null);
      setCheckingAccess(false);
    }).catch(() => {
      if (active) {
        setBusinessRole(null);
        setCheckingAccess(false);
      }
    });
    return () => { active = false; };
  }, [activeRole]);
  if (checkingAccess) return null;
  if (activeRole === 'customer' && !businessRole) return <Redirect href="/" />;
  const isOwner = businessRole === 'owner';
  return (
    <Tabs screenOptions={screenOptions}>
      <Tabs.Screen
        name="dashboard"
        options={{
          tabBarBadge: badgeLabel(unread),
          tabBarBadgeStyle: { backgroundColor: t.colors.danger, color: '#FFFFFF', fontSize: 11 },
          title: 'Jobs',
          tabBarIcon: ({ color, focused }) => <TabIcon name="briefcase-outline" activeName="briefcase" focused={focused} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="earnings"
        options={{
          href: isOwner ? undefined : null,
          title: 'Earnings',
          tabBarIcon: ({ color, focused }) => <TabIcon name="wallet-outline" activeName="wallet" focused={focused} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="pro-account"
        options={{
          href: isOwner ? undefined : null,
          title: 'Me',
          tabBarIcon: ({ color, focused }) => <TabIcon name="person-circle-outline" activeName="person-circle" focused={focused} color={color as string} />,
        }}
      />
      <Tabs.Screen name="business-tools" options={{ href: null }} />
    </Tabs>
  );
}
