import { Ionicons } from '@expo/vector-icons';
import { Linking, Pressable, View } from 'react-native';
import type { DiagnosisCard, DraftCard, EstimateCard, ProviderPick, ProvidersCard, SafetyCard } from '../../lib/assistant/types';
import { formatINR } from '../../lib/money';
import { useTheme } from '../../theme';
import { CategoryIcon, iconForSlug } from '../CategoryIcon';
import { skillLabel } from '../ProviderCard';
import { Avatar, Badge, Button, Card, Divider, Text } from '../ui';

function CardTitle({ icon, title, color }: { icon: keyof typeof Ionicons.glyphMap; title: string; color?: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
      <Ionicons name={icon} size={18} color={color ?? t.colors.primaryText} />
      <Text variant="calloutStrong" style={{ flex: 1 }}>
        {title}
      </Text>
    </View>
  );
}

function Bullets({ items, icon = 'ellipse' }: { items: string[]; icon?: keyof typeof Ionicons.glyphMap }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {items.map((s, i) => (
        <View key={`${i}-${s}`} style={{ flexDirection: 'row', gap: t.spacing.sm, alignItems: 'flex-start' }}>
          <Ionicons name={icon} size={icon === 'ellipse' ? 6 : 14} color={t.colors.muted} style={{ marginTop: icon === 'ellipse' ? 7 : 3 }} />
          <Text variant="footnote" color="textSecondary" style={{ flex: 1 }}>
            {s}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function SafetyCardView({ card }: { card: SafetyCard }) {
  const t = useTheme();
  return (
    <Card variant="tinted" tint={t.colors.dangerSoft} gap={t.spacing.md} accessibilityLabel={`Safety: ${card.title}`}>
      <CardTitle icon="warning" title={card.title} color={t.colors.dangerText} />
      <View style={{ gap: 6 }}>
        {card.steps.map((s, i) => (
          <View key={`${i}-${s}`} style={{ flexDirection: 'row', gap: t.spacing.sm }}>
            <Text variant="footnoteStrong" color="dangerText" tabular>
              {i + 1}.
            </Text>
            <Text variant="footnote" color="text" style={{ flex: 1 }}>
              {s}
            </Text>
          </View>
        ))}
      </View>
      {card.emergency.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
          {card.emergency.map((e) => (
            <Button
              key={e.number}
              title={`${e.label} ${e.number}`}
              variant="destructive"
              size="sm"
              leftIcon="call"
              onPress={() => void Linking.openURL(`tel:${e.number}`)}
              accessibilityLabel={`Call ${e.label}, ${e.number}`}
            />
          ))}
        </View>
      ) : null}
    </Card>
  );
}

export function DiagnosisCardView({ card }: { card: DiagnosisCard }) {
  const t = useTheme();
  return (
    <Card gap={t.spacing.md} accessibilityLabel={`Diagnosis: ${card.title}. Confidence ${card.confidence}`}>
      <CardTitle icon="medkit-outline" title={card.title} />
      <Badge
        label={card.confidence === 'high' ? 'Likely cause is clear' : card.confidence === 'medium' ? 'A few possible causes' : 'Needs an on-site check'}
        tone={card.confidence === 'high' ? 'success' : card.confidence === 'medium' ? 'info' : 'neutral'}
      />
      {card.likely_issues.length ? (
        <View style={{ gap: 6 }}>
          <Text variant="overline" color="muted">
            Likely causes
          </Text>
          <Bullets items={card.likely_issues} />
        </View>
      ) : null}
      {card.pro_checks.length ? (
        <View style={{ gap: 6 }}>
          <Text variant="overline" color="muted">
            What the pro will check
          </Text>
          <Bullets items={card.pro_checks} icon="checkmark" />
        </View>
      ) : null}
      {card.safety_tip ? (
        <View
          style={{
            flexDirection: 'row',
            gap: t.spacing.sm,
            padding: t.spacing.md,
            borderRadius: t.radii.sm,
            backgroundColor: t.colors.warningSoft,
          }}
        >
          <Ionicons name="shield-half-outline" size={16} color={t.colors.warningText} style={{ marginTop: 1 }} />
          <Text variant="footnote" color="text" style={{ flex: 1 }}>
            {card.safety_tip}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

export function EstimateCardView({ card }: { card: EstimateCard }) {
  const t = useTheme();
  const v = card.visit_fee;
  const tot = card.typical_total;
  return (
    <Card gap={t.spacing.md} accessibilityLabel={`Price estimate for ${card.category_name}`}>
      <CardTitle icon="pricetag-outline" title={`Typical prices · ${card.category_name}`} />
      <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="caption" color="muted">
            Visit fee (pay now)
          </Text>
          <Text variant="bodyStrong" tabular>
            {v ? (v.min === v.max ? formatINR(v.min) : `${formatINR(v.min)}–${formatINR(v.max)}`) : 'No data yet'}
          </Text>
          {v ? (
            <Text variant="caption" color="muted">
              Usually {formatINR(v.median)}
            </Text>
          ) : null}
        </View>
        <View style={{ width: 1, backgroundColor: t.colors.border }} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="caption" color="muted">
            Typical total
          </Text>
          <Text variant="bodyStrong" tabular>
            {tot ? `${formatINR(tot.low)}–${formatINR(tot.high)}` : 'Not enough data'}
          </Text>
          {tot ? (
            <Text variant="caption" color="muted">
              Median {formatINR(tot.median)}
            </Text>
          ) : null}
        </View>
      </View>
      {card.note ? (
        <Text variant="caption" color="textSecondary">
          {card.note}
        </Text>
      ) : null}
    </Card>
  );
}

function ProviderRow({ p, onOpen, onBook }: { p: ProviderPick; onOpen: () => void; onBook: () => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${p.name}, rated ${p.rating_avg.toFixed(1)}. ${p.reason}. View profile`}
        style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, opacity: pressed ? 0.7 : 1 })}
      >
        <Avatar name={p.name} size={44} online={p.is_online} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="subheadStrong" numberOfLines={1}>
            {p.name}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            {p.rating_count > 0 ? (
              <>
                <Ionicons name="star" size={12} color={t.colors.star} />
                <Text variant="caption" tabular>
                  {p.rating_avg.toFixed(1)} ({p.rating_count})
                </Text>
                <Text variant="caption" color="muted">
                  ·
                </Text>
              </>
            ) : null}
            <Text variant="caption" color="muted" numberOfLines={1}>
              Visit {formatINR(p.visit_fee)}
              {p.distance_km != null ? ` · ${p.distance_km.toFixed(1)} km` : ''}
              {p.skill_level && skillLabel[p.skill_level as keyof typeof skillLabel] ? ` · ${skillLabel[p.skill_level as keyof typeof skillLabel]}` : ''}
            </Text>
          </View>
          {p.reason ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name={p.previously_booked ? 'heart' : 'sparkles'} size={12} color={t.colors.primaryText} />
              <Text variant="caption" color="primaryText" numberOfLines={1} style={{ flex: 1 }}>
                {p.reason}
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>
      <Button title="Book" size="sm" variant="secondary" onPress={onBook} accessibilityLabel={`Book ${p.name}`} />
    </View>
  );
}

export function ProvidersCardView({
  card,
  onOpen,
  onBook,
}: {
  card: ProvidersCard;
  onOpen: (p: ProviderPick) => void;
  onBook: (p: ProviderPick) => void;
}) {
  const t = useTheme();
  return (
    <Card gap={t.spacing.md} accessibilityLabel={`Recommended ${card.category_name} pros`}>
      <CardTitle icon="people-outline" title={`Recommended ${card.category_name} pros`} />
      {card.providers.map((p, i) => (
        <View key={p.provider_service_id} style={{ gap: t.spacing.md }}>
          {i > 0 ? <Divider /> : null}
          <ProviderRow p={p} onOpen={() => onOpen(p)} onBook={() => onBook(p)} />
        </View>
      ))}
    </Card>
  );
}

function DraftRow({ icon, label, value, hint }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; hint?: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: t.spacing.md, alignItems: 'flex-start' }}>
      <Ionicons name={icon} size={18} color={t.colors.muted} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, gap: 1 }}>
        <Text variant="caption" color="muted">
          {label}
        </Text>
        <Text variant="subhead" color="text">
          {value}
        </Text>
        {hint ? (
          <Text variant="caption" color="warningText">
            {hint}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function DraftCardView({ card, onReview }: { card: DraftCard; onReview: () => void }) {
  const t = useTheme();
  const where = [card.address.label, card.address.area, card.address.city].filter(Boolean).join(', ');
  return (
    <Card variant="elevated" gap={t.spacing.md} style={{ borderColor: t.colors.primary, borderWidth: 1.5 }} accessibilityLabel="Booking draft">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
        <CategoryIcon icon={iconForSlug(card.category_slug)} size={40} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="overline" color="primaryText">
            Booking draft
          </Text>
          <Text variant="calloutStrong" numberOfLines={1}>
            {card.category_name} · {card.provider.name}
          </Text>
        </View>
        <Badge label="Not booked yet" tone="neutral" />
      </View>
      <Divider />
      <DraftRow icon="document-text-outline" label="Problem" value={card.description_en} />
      {card.problem_chips.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginLeft: 30 }}>
          {card.problem_chips.map((c) => (
            <Badge key={c} label={c} tone="info" />
          ))}
        </View>
      ) : null}
      <DraftRow icon={card.slot.type === 'asap' ? 'flash-outline' : 'calendar-outline'} label="When" value={card.slot.label} />
      <DraftRow
        icon="location-outline"
        label="Address"
        value={where || 'Your selected location'}
        hint={card.address.needs_full_address ? 'Add your house / flat number at checkout' : undefined}
      />
      <DraftRow icon="wallet-outline" label="Pay now" value={`${formatINR(card.provider.visit_fee)} visit fee · rest after you approve the quote`} />
      <Button title="Review & pay" leftIcon="arrow-forward-circle" onPress={onReview} fullWidth accessibilityHint="Opens checkout with these details. Nothing is booked until you pay." />
      <Text variant="caption" color="muted" align="center">
        The pro's fee and availability are re-checked at checkout.
      </Text>
    </Card>
  );
}
