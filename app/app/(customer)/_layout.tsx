import { Redirect, Tabs } from 'expo-router';
import { useAuth } from '../../src/lib/auth';
import { badgeLabel } from '../../src/lib/unread';
import { useTheme } from '../../src/theme';
import { TabIcon, useTabScreenOptions } from '../../src/components/tabOptions';
import { ActivityUnreadProvider, useActivityUnread } from '../../src/features/activity/ActivityUnreadProvider';

export const unstable_settings = { initialRouteName: 'index' };

export default function CustomerTabs() {
  const { activeRole } = useAuth();
  if (activeRole === 'provider') return <Redirect href="/dashboard" />;
  return (
    <ActivityUnreadProvider>
      <CustomerTabsContent />
    </ActivityUnreadProvider>
  );
}

function CustomerTabsContent() {
  const screenOptions = useTabScreenOptions();
  const t = useTheme();
  const unread = useActivityUnread().total;
  return (
    <Tabs screenOptions={screenOptions}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => <TabIcon name="home-outline" activeName="home" focused={focused} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="bookings"
        options={{
          tabBarBadge: badgeLabel(unread),
          tabBarBadgeStyle: { backgroundColor: t.colors.danger, color: '#FFFFFF', fontSize: 11 },
          title: 'Bookings',
          tabBarIcon: ({ color, focused }) => <TabIcon name="calendar-outline" activeName="calendar" focused={focused} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Me',
          tabBarIcon: ({ color, focused }) => <TabIcon name="person-circle-outline" activeName="person-circle" focused={focused} color={color as string} />,
        }}
      />
    </Tabs>
  );
}
