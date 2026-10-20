import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { useAuth } from '../../src/lib/auth';
import { useTabScreenOptions } from '../../src/components/tabOptions';

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
          tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? 'home' : 'home-outline'} size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="bookings"
        options={{
          title: 'Bookings',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'calendar' : 'calendar-outline'} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Me',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'person-circle' : 'person-circle-outline'} size={25} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
