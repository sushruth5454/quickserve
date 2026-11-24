import { router } from 'expo-router';
import { View } from 'react-native';
import { Card, Header, ListItem, Screen, Text } from '../../components/ui';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import { isBrandingSettingsVisible } from './model';

const SETTINGS_ROUTES = [
  ['/admin/features', 'Feature controls', 'Runtime switches and service types'],
  ['/admin/rules', 'Booking rules', 'Recurring and sports operating limits'],
  ['/admin/commission', 'Commission', 'Provider and creator commission settings'],
  ['/admin/fees', 'Platform fees', 'Customer-facing platform fee configuration'],
  ['/admin/coins', 'Coins', 'Earning and redemption configuration'],
  ['/admin/geography', 'Geography', 'Supported service locations'],
  ['/admin/sports', 'Sports', 'Sports catalogue and venue configuration'],
  ['/admin/shops', 'Shops', 'Shop and product configuration'],
  ['/admin/services', 'Services', 'Service catalogue configuration'],
] as const;

export default function SettingsScreen() {
  const features = useAppFeatureFlags();
  const brandingVisible = isBrandingSettingsVisible(features);

  return (
    <Screen header={<Header title="Admin settings" subtitle="Configuration and appearance" />}>
      <Card padding={0} gap={0}>
        {SETTINGS_ROUTES.map(([route, title, subtitle]) => (
          <ListItem
            key={route}
            title={title}
            subtitle={subtitle}
            chevron
            onPress={() => router.push(route)}
          />
        ))}
        {brandingVisible ? (
          <ListItem
            title="Branding & appearance"
            subtitle="Edit the isolated draft, preview, publication history and recovery"
            chevron
            onPress={() => router.push('/admin/settings/branding')}
          />
        ) : null}
      </Card>
      <View>
        <Text variant="footnote" color="muted">
          Existing configuration pages retain their own authorization and feature checks.
        </Text>
      </View>
    </Screen>
  );
}
