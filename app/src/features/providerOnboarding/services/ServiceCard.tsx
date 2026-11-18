import { useMemo, useState } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { CategoryIcon, iconForSlug } from '../../../components/CategoryIcon';
import { SkillBadge } from '../../../components/ProviderCard';
import { Badge, Button, Card, Chip, InlineAlert, Input, Text } from '../../../components/ui';
import { addRateCardItem } from '../../../lib/api';
import { formatINR } from '../../../lib/money';
import { onboardingApi } from '../../../lib/onboarding';
import { parseRupees } from '../../../lib/onboarding/validation';
import type { ServicePackage } from '../../../lib/types';
import { useTheme } from '../../../theme';
import type { EditableService } from '../serviceEditor';
import { packagePriceLabel } from './model';
import { ProviderPackageEditor } from '../ProviderPackageEditor';

export function ServiceCard(props: {
  service: EditableService;
  skillLabels: string[];
  expertiseAvailable: boolean;
  rateSuggestions: string[];
  showLinks?: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onChanged: () => Promise<void>;
}) {
  const t = useTheme();
  const { service: s } = props;
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [adding, setAdding] = useState(false);
  const [packageEditing, setPackageEditing] = useState<ServicePackage | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const items = s.rate_card_items ?? [];
  const unusedSuggestions = useMemo(() => props.rateSuggestions.filter((r) => !items.some((i) => i.title === r)), [props.rateSuggestions, items]);

  const add = async () => {
    const p = parseRupees(price);
    if (!title.trim() || p == null || p <= 0) return setErr('Enter a name and a price.');
    setBusy(true);
    try {
      await addRateCardItem(s.id, title.trim(), p);
      setTitle('');
      setPrice('');
      setAdding(false);
      setErr(null);
      await props.onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card gap={t.spacing.md}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
        <View style={{ opacity: s.active ? 1 : 0.5 }}>
          <CategoryIcon icon={iconForSlug(s.categories?.slug)} size={44} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="title3">{s.categories?.name}</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <SkillBadge level={s.skill_level} />
            {!s.active ? <Badge label="Removed" tone="neutral" /> : null}
          </View>
        </View>
        <Button title="Edit" size="sm" variant="ghost" onPress={props.onEdit} />
      </View>
      <Text variant="footnote" color="textSecondary" tabular>
        Visit {formatINR(s.visit_fee)} · Labour {formatINR(s.labour_rate)}/{s.rate_unit}
      </Text>
      {props.skillLabels.length ? (
        <Text variant="footnote" color="textSecondary" numberOfLines={3} accessibilityLabel={`Expertise: ${props.skillLabels.join(', ')}`}>
          {props.skillLabels.slice(0, 8).join(' · ')}
          {props.skillLabels.length > 8 ? ` · +${props.skillLabels.length - 8} more` : ''}
        </Text>
      ) : props.expertiseAvailable ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Add expertise for ${s.categories?.name ?? 'service'}`} onPress={props.onEdit}>
          <Text variant="footnote" color="warningText">
            No expertise selected — customers can’t match you to specific jobs. Tap to add.
          </Text>
        </Pressable>
      ) : null}
      {props.showLinks ? (
        <Button
          title="Instagram, YouTube & website links"
          size="sm"
          variant="outline"
          leftIcon="link-outline"
          onPress={() => router.push({ pathname: '/provider-profile/[section]', params: { section: 'portfolio', returnTo: 'services' } })}
        />
      ) : null}
      {items.map((r) => (
        <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.sm }}>
          <Text variant="callout" style={{ flex: 1 }}>
            {r.title}
          </Text>
          <Text variant="calloutStrong" tabular>
            {formatINR(r.price)}
          </Text>
          <Button
            title="Remove"
            size="sm"
            variant="destructiveGhost"
            accessibilityLabel={`Remove ${r.title}`}
            onPress={() => void onboardingApi.deleteRateCardItem(r.id).then(props.onChanged).catch((e: Error) => setErr(e.message))}
          />
        </View>
      ))}
      <View style={{ gap: t.spacing.md, borderTopWidth: 1, borderTopColor: t.colors.border, paddingTop: t.spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="footnoteStrong" color="muted">
            Packages
          </Text>
          {!packageEditing ? (
            <Button title="Add package" size="sm" variant="ghost" leftIcon="add" onPress={() => setPackageEditing('new')} />
          ) : null}
        </View>
        {(s.service_packages ?? []).map((item) => (
          <View key={item.id} style={{ gap: 6, borderRadius: t.radii.md, backgroundColor: t.colors.surfaceAlt, padding: t.spacing.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
              <Text variant="calloutStrong" style={{ flex: 1 }}>
                {item.title}
              </Text>
              {!item.active ? <Badge label="Hidden" tone="neutral" /> : null}
              <Button title="Edit" size="sm" variant="ghost" onPress={() => setPackageEditing(item)} />
            </View>
            <Text variant="footnoteStrong" color="primaryText">
              {packagePriceLabel(item)}
            </Text>
            {item.deliverables.length ? (
              <Text variant="footnote" color="textSecondary">
                {item.deliverables.map((deliverable) => `${deliverable.qty} × ${deliverable.type} — ${deliverable.spec}`).join('\n')}
              </Text>
            ) : null}
            <Button
              title="Delete package"
              size="sm"
              variant="destructiveGhost"
              onPress={() =>
                void onboardingApi
                  .deleteServicePackage(item.id)
                  .then(props.onChanged)
                  .then(() => setPackageEditing(null))
                  .catch((e: Error) => setErr(e.message))
              }
            />
          </View>
        ))}
        {packageEditing ? (
          <ProviderPackageEditor
            key={packageEditing === 'new' ? 'new' : packageEditing.id}
            providerServiceId={s.id}
            servicePackage={packageEditing === 'new' ? undefined : packageEditing}
            onCancel={() => setPackageEditing(null)}
            onSaved={async () => {
              setPackageEditing(null);
              await props.onChanged();
            }}
          />
        ) : null}
      </View>
      <InlineAlert message={err} />
      {adding ? (
        <View style={{ gap: t.spacing.sm }}>
          {unusedSuggestions.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.spacing.sm }}>
              {unusedSuggestions.map((r) => (
                <Chip key={r} label={r} selected={title === r} onPress={() => setTitle(r)} />
              ))}
            </ScrollView>
          ) : null}
          <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
            <Input placeholder="e.g. Gas refill" value={title} onChangeText={setTitle} containerStyle={{ flex: 2 }} accessibilityLabel="Rate card item" maxLength={80} />
            <Input prefix="₹" keyboardType="decimal-pad" value={price} onChangeText={(v) => setPrice(v.replace(/[^\d.]/g, ''))} containerStyle={{ flex: 1 }} accessibilityLabel="Price" />
          </View>
          <Button title="Add to rate card" size="sm" onPress={() => void add()} loading={busy} />
        </View>
      ) : s.active ? (
        <Button title="Add rate card item" size="sm" variant="ghost" leftIcon="add" onPress={() => setAdding(true)} style={{ alignSelf: 'flex-start' }} />
      ) : null}
      {s.active ? <Button title="Remove service" size="sm" variant="destructiveGhost" onPress={props.onRemove} style={{ alignSelf: 'flex-start' }} /> : null}
    </Card>
  );
}
