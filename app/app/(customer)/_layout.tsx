import { Redirect, Tabs } from 'expo-router';
import { useAuth } from '../../src/lib/auth';
import { TabIcon, useTabScreenOptions } from '../../src/components/tabOptions';

export const unstable_settings = { initialRouteName: 'index' };

export default function CustomerTabs() {
  const { activeRole } = useAuth();
  const screenOptions = useTabScreenOptions();
  if (activeRole === 'provider') return <Redirect href="/dashboard" />;
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
