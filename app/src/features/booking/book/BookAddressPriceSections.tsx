import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Button, Card, Divider, PriceRow, Text } from '../../../components/ui';
import { addressIcon } from '../../../components/AddressEditor';
import { formatINR } from '../../../lib/money';
import type { BookingPricePreview } from './model';
import type { BookScreenController } from './useBookScreenController';
import { Block } from './BookControls';

export function BookAddressPriceSections({
  controller,
  firstName,
  range,
  pricePreview,
}: {
  controller: BookScreenController;
  firstName: string;
  range: [number, number] | null;
  pricePreview: BookingPricePreview;
}) {
  const { t, location, hasAddress, setEditorOpen, service } = controller;
  return (
    <>
      <Block title="Address">
        <Card padding={t.spacing.md} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
          <View
            style={{ width: 40, height: 40, borderRadius: t.radii.md, backgroundColor: t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name={addressIcon(location.label)} size={20} color={t.colors.textSecondary} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="calloutStrong">{location.label ?? location.area}</Text>
            <Text variant="footnote" color="textSecondary">
              {location.line1 ? `${location.line1}, ${location.city}` : `${location.area}, ${location.city} · house / flat no. needed`}
            </Text>
          </View>
          <Button title="Change" variant="ghost" size="sm" onPress={() => router.push('/location')} />
        </Card>
        {!hasAddress ? (
          <Button
            title="Add house / flat number"
            variant="outline"
            leftIcon="add"
            onPress={() => setEditorOpen(true)}
            fullWidth
          />
        ) : null}
      </Block>

      <Block title="Price details">
        <Card gap={t.spacing.md}>
          <PriceRow label="Visit / inspection fee" amount={pricePreview.visit_fee} hint="Adjusted in your final bill" />
          <PriceRow
            label="Platform fee"
            amount={pricePreview.platform_fee}
            hint="Added to the final bill — not charged now"
            emphasis="muted"
          />
          <PriceRow
            label="Minimum total including platform fee"
            amount={pricePreview.total}
            hint="The provider's approved quote determines the final service amount"
          />
          <Divider />
          <PriceRow label="To pay now" amount={pricePreview.pay_now} emphasis="total" />
          {range ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
              <Ionicons name="analytics-outline" size={16} color={t.colors.muted} />
              <Text variant="footnote" color="textSecondary" style={{ flex: 1 }}>
                Typical total for {service?.categories?.name ?? 'this job'}: {formatINR(range[0] * 100)}–{formatINR(range[1] * 100)}. {firstName} sends an
                itemised quote after inspecting — nothing more is charged until you approve it.
              </Text>
            </View>
          ) : null}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: t.spacing.sm,
              paddingTop: t.spacing.md,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: t.colors.border,
            }}
          >
            <Ionicons name="shield-checkmark" size={16} color={t.colors.successText} />
            <Text variant="footnote" color="textSecondary" style={{ flex: 1 }}>
              Payment held by QuickServe until the job is done.
            </Text>
          </View>
        </Card>
      </Block>
    </>
  );
}
