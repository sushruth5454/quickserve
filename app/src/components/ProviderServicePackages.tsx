import { View } from 'react-native';
import { formatINR } from '../lib/money';
import type { ServicePackage } from '../lib/types';
import { useTheme } from '../theme';
import { Card, Chip, Text } from './ui';

export function packageDisplayPrice(servicePackage: ServicePackage) {
  switch (servicePackage.price_type) {
    case 'quote':
      return 'Price on request';
    case 'range':
      return `${formatINR(servicePackage.price_min ?? 0)}–${formatINR(servicePackage.price_max ?? 0)} / ${servicePackage.unit}`;
    case 'from':
      return `From ${formatINR(servicePackage.price_min ?? 0)} / ${servicePackage.unit}`;
    default:
      return `${formatINR(servicePackage.price ?? servicePackage.price_min ?? 0)} / ${servicePackage.unit}`;
  }
}

export function ProviderServicePackages({ packages }: { packages: ServicePackage[] }) {
  const t = useTheme();
  const visible = packages.filter((item) => item.active);
  if (visible.length === 0) return null;
  return (
    <View style={{ gap: t.spacing.md }}>
      <Text variant="footnoteStrong" color="muted">
        Packages
      </Text>
      {visible.map((item) => (
        <Card key={item.id} gap={t.spacing.sm} variant="outlined">
          <View style={{ gap: 3 }}>
            <Text variant="calloutStrong">{item.title}</Text>
            <Text variant="title3" color="primaryText">
              {packageDisplayPrice(item)}
            </Text>
          </View>
          {item.description ? (
            <Text variant="footnote" color="textSecondary">
              {item.description}
            </Text>
          ) : null}
          <View style={{ gap: t.spacing.xs }}>
            {item.deliverables.map((deliverable, index) => (
              <Text key={`${deliverable.type}-${index}`} variant="footnote" color="text">
                {deliverable.qty} × {deliverable.type.replaceAll('_', ' ')} — {deliverable.spec}
              </Text>
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.xs }}>
            {item.turnaround_days != null ? <Chip label={`${item.turnaround_days} day turnaround`} selected={false} check={false} /> : null}
            <Chip label={`${item.revisions_included} revision${item.revisions_included === 1 ? '' : 's'}`} selected={false} check={false} />
            {item.raw_files_included ? <Chip label="Raw files included" selected={false} check={false} /> : null}
            {item.travel_included_km > 0 ? <Chip label={`${item.travel_included_km} km travel included`} selected={false} check={false} /> : null}
            {item.usage_rights.paid_ads_days ? (
              <Chip label={`${item.usage_rights.paid_ads_days} days paid-ad usage`} selected={false} check={false} />
            ) : (
              <Chip label="No paid-ad usage" selected={false} check={false} />
            )}
            {item.usage_rights.exclusivity_days ? (
              <Chip label={`${item.usage_rights.exclusivity_days} days exclusivity`} selected={false} check={false} />
            ) : null}
          </View>
          {item.inclusions.length ? (
            <Text variant="footnote" color="textSecondary">
              Includes: {item.inclusions.join(', ')}
            </Text>
          ) : null}
          {item.exclusions.length ? (
            <Text variant="footnote" color="muted">
              Excludes: {item.exclusions.join(', ')}
            </Text>
          ) : null}
          {item.price_type !== 'fixed' ? (
            <Text variant="caption" color="muted">
              The final payable amount must be fixed in a proposal before payment.
            </Text>
          ) : null}
        </Card>
      ))}
    </View>
  );
}
