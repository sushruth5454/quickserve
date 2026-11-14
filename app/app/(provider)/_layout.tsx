import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { useAuth } from '../../src/lib/auth';
import { useTabScreenOptions } from '../../src/components/tabOptions';

export const unstable_settings = { initialRouteName: 'dashboard' };

export default function ProviderTabs() {
  const { activeRole } = useAuth();
  const screenOptions = useTabScreenOptions();
  if (activeRole === 'customer') return <Redirect href="/" />;
  return (
    <Tabs screenOptions={screenOptions}>
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Jobs',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'briefcase' : 'briefcase-outline'} size={24} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="earnings"
        options={{
          title: 'Earnings',
          tabBarIcon: ({ color, focused }) => <Ionicons name={focused ? 'wallet' : 'wallet-outline'} size={24} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="pro-account"
        options={{
          title: 'Me',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'person-circle' : 'person-circle-outline'} size={25} color={color as string} />
          ),
        }}
      />
    </Tabs>
  );
}
