import { Redirect, Tabs } from 'expo-router';
import { useAuth } from '../../src/lib/auth';
import { badgeLabel } from '../../src/lib/unread';
import { useUnread } from '../../src/lib/unreadContext';
import { useTheme } from '../../src/theme';
import { TabIcon, useTabScreenOptions } from '../../src/components/tabOptions';

export const unstable_settings = { initialRouteName: 'dashboard' };

export default function ProviderTabs() {
  const { activeRole } = useAuth();
  const screenOptions = useTabScreenOptions();
  const t = useTheme();
  const unread = useUnread().total('provider');
  if (activeRole === 'customer') return <Redirect href="/" />;
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
          title: 'Earnings',
          tabBarIcon: ({ color, focused }) => <TabIcon name="wallet-outline" activeName="wallet" focused={focused} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="pro-account"
        options={{
          title: 'Me',
          tabBarIcon: ({ color, focused }) => <TabIcon name="person-circle-outline" activeName="person-circle" focused={focused} color={color as string} />,
        }}
      />
    </Tabs>
  );
}
