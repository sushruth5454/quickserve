import { Ionicons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';
import { Badge, Card, Chip, Text } from '../../../components/ui';
import { formatINR } from '../../../lib/money';
import type { ServicePackage } from '../../../lib/types';
import { useTheme } from '../../../theme';
import { packageDisplayPrice } from './packageModel';

export function PackageCard({
  servicePackage,
  providerName,
  rating,
  ratingCount,
  providerOnline,
  providerPaused,
  actionLabel,
  onPress,
}: {
  servicePackage: ServicePackage;
  providerName: string;
  rating?: number;
  ratingCount?: number;
  providerOnline?: boolean;
  providerPaused?: boolean;
  actionLabel?: string;
  onPress?: () => void;
}) {
  const t = useTheme();
  const content = (
    <Card variant="elevated" gap={t.spacing.md}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.md }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text variant="title3">{servicePackage.title}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text variant="footnote" color="muted">{providerName}</Text>
            {providerOnline != null || providerPaused != null ? (
              <Badge
                label={providerPaused ? 'On holiday' : providerOnline ? 'Online' : 'Offline'}
                tone={providerPaused ? 'warning' : providerOnline ? 'success' : 'neutral'}
                dot
              />
            ) : null}
            {(ratingCount ?? 0) > 0 ? (
              <>
                <Ionicons name="star" size={12} color={t.colors.star} />
                <Text variant="captionStrong">{Number(rating ?? 0).toFixed(1)} ({ratingCount})</Text>
              </>
            ) : null}
          </View>
        </View>
        <Text variant="title3" color="primaryText">{packageDisplayPrice(servicePackage)}</Text>
      </View>
      {servicePackage.description ? <Text variant="callout" color="textSecondary">{servicePackage.description}</Text> : null}
      {(servicePackage.deliverables ?? []).map((deliverable, index) => (
        <Text key={`${deliverable.type}-${index}`} variant="footnote" color="text">
          {deliverable.qty} × {deliverable.type.replaceAll('_', ' ')} — {deliverable.spec}
        </Text>
      ))}
      {(servicePackage.inclusions ?? []).length ? (
        <View style={{ gap: 4 }}>
          <Text variant="footnoteStrong" color="muted">Includes</Text>
          {(servicePackage.inclusions ?? []).map((item) => <Text key={item} variant="footnote" color="textSecondary">• {item}</Text>)}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.xs }}>
        {servicePackage.duration_min != null ? <Chip label={`${servicePackage.duration_min} min`} selected={false} check={false} /> : null}
        {servicePackage.turnaround_days != null ? <Chip label={`${servicePackage.turnaround_days} day delivery`} selected={false} check={false} /> : null}
        <Chip label={`${servicePackage.revisions_included ?? 0} revision${servicePackage.revisions_included === 1 ? '' : 's'}`} selected={false} check={false} />
        {servicePackage.usage_rights?.paid_ads_days ? <Chip label={`${servicePackage.usage_rights.paid_ads_days} days paid-ad use`} selected={false} check={false} /> : null}
        {servicePackage.travel_included_km > 0 ? <Chip label={`${servicePackage.travel_included_km} km travel included`} selected={false} check={false} /> : null}
      </View>
      {servicePackage.price_type !== 'fixed' ? (
        <Text variant="caption" color="muted">A fixed final amount will be approved before any payment.</Text>
      ) : null}
      {actionLabel && onPress ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: t.spacing.xs }}>
          <Text variant="caption" color="muted">
            {servicePackage.price_type === 'fixed' ? `Full price ${formatINR(servicePackage.price ?? 0)}` : 'No payment now'}
          </Text>
          <Text variant="bodyStrong" color="primaryText">{actionLabel}</Text>
        </View>
      ) : null}
    </Card>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={`${actionLabel}: ${servicePackage.title}`} onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.82 : 1 })}>
      {content}
    </Pressable>
  ) : content;
}
