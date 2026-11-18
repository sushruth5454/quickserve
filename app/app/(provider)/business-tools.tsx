import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Share, View } from 'react-native';
import { Button, Card, EmptyState, Header, InlineAlert, Input, Screen, Section, Text, TextArea, useToast } from '../../src/components/ui';
import {
  cancelByoInvite,
  createByoInvite,
  listMyByoInvites,
  type ByoInviteResult,
  type ByoInviteSummary,
} from '../../src/lib/providerBusiness';
import { listMyServices } from '../../src/lib/api';
import { formatINR, rupeesToPaise } from '../../src/lib/money';
import { useTheme } from '../../src/theme';
import type { ProviderService } from '../../src/lib/types';

export default function BusinessTools() {
  const t = useTheme();
  const toast = useToast();
  const [services, setServices] = useState<ProviderService[]>([]);
  const [invites, setInvites] = useState<ByoInviteSummary[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [customer, setCustomer] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ByoInviteResult | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, i] = await Promise.all([listMyServices(), listMyByoInvites()]);
      setServices(s);
      setInvites(i);
      setServiceId((current) => current || s[0]?.id || '');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useFocusEffect(useCallback(() => void load(), [load]));

  const amountPaise = rupeesToPaise(Number(amount));
  const feePaise = Math.round(amountPaise * 0.03);
  const canCreate = !!serviceId && customer.trim().length >= 2 && description.trim().length > 0 && amountPaise > 0;

  const create = async () => {
    if (!canCreate || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createByoInvite({
        providerServiceId: serviceId,
        customerLabel: customer,
        description,
        amountPaise,
        scheduledAt: null,
      });
      setCreated(result);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const share = async (url: string) => {
    await Share.share({
      title: 'Protected QuickServe booking',
      message: `Open your QuickServe booking invite:\n${url}\n\nNo phone number is included in this link.`,
    });
  };

  const cancel = async (invite: ByoInviteSummary) => {
    try {
      await cancelByoInvite(invite.invite_id);
      await load();
      toast({ message: 'Invite cancelled' });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Screen
      header={<Header title="Business tools" subtitle="Bring an existing client on-platform" onBack={() => router.back()} />}
      gap={t.spacing.xl}
    >
      <InlineAlert
        tone="success"
        icon="shield-checkmark-outline"
        title="3% tools fee · no provider commission"
        message="The client pays the agreed job amount plus 3%. Your payout is the agreed amount, after the normal hold."
      />

      <Card gap={t.spacing.lg}>
        <View style={{ gap: 4 }}>
          <Text variant="title3">Create a protected booking</Text>
          <Text variant="footnote" color="muted">
            Share the bearer link yourself. QuickServe never asks for or displays the client's phone number here.
          </Text>
        </View>

        <View style={{ gap: t.spacing.sm }}>
          <Text variant="subheadStrong">Service</Text>
          {services.map((service) => {
            const selected = service.id === serviceId;
            return (
              <Pressable
                key={service.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => setServiceId(service.id)}
                style={{
                  minHeight: 48,
                  borderRadius: t.radii.md,
                  borderWidth: selected ? 2 : 1,
                  borderColor: selected ? t.colors.primary : t.colors.border,
                  backgroundColor: selected ? t.colors.primarySoft : t.colors.surface,
                  padding: selected ? t.spacing.md - 1 : t.spacing.md,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: t.spacing.sm,
                }}
              >
                <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? t.colors.primaryText : t.colors.muted} />
                <Text variant="bodyStrong">{service.categories?.name ?? 'Service'}</Text>
              </Pressable>
            );
          })}
          {!services.length ? <Text variant="footnote" color="muted">Add a live service in your provider profile first.</Text> : null}
        </View>

        <Input
          label="Client name"
          placeholder="Client's first name"
          value={customer}
          onChangeText={setCustomer}
          maxLength={80}
          autoComplete="off"
          helper="Do not enter a phone number, email or payment handle."
        />
        <TextArea
          label="Agreed job"
          placeholder="Service and agreed scope"
          value={description}
          onChangeText={setDescription}
          maxLength={1000}
        />
        <Input
          label="Agreed amount"
          prefix="₹"
          placeholder="2500"
          value={amount}
          onChangeText={(v) => setAmount(v.replace(/[^\d.]/g, '').slice(0, 9))}
          keyboardType="decimal-pad"
        />

        {amountPaise > 0 ? (
          <View style={{ gap: 6 }}>
            <PriceRow label="Client pays for the job" amount={amountPaise} />
            <PriceRow label="3% QuickServe tools fee" amount={feePaise} />
            <PriceRow label="Total" amount={amountPaise + feePaise} strong />
          </View>
        ) : null}

        <InlineAlert message={error} />
        <Button title="Create secure invite" onPress={() => void create()} loading={busy} disabled={!canCreate} fullWidth leftIcon="link-outline" />
      </Card>

      {created ? (
        <Card gap={t.spacing.md}>
          <Text variant="title3">Invite ready</Text>
          <Text variant="callout" color="muted">The secure token expires in 7 days. It cannot be recovered here after you leave this screen.</Text>
          <Button title="Share invite" onPress={() => void share(created.share_url)} leftIcon="share-outline" fullWidth />
        </Card>
      ) : null}

      <Section title="Recent invites">
        {invites.length === 0 ? (
          <EmptyState icon="link-outline" title="No client invites yet" message="Create an invite when an existing client wants to pay safely in QuickServe." compact />
        ) : (
          <Card padding={0} gap={0}>
            {invites.map((invite) => (
              <View key={invite.invite_id} style={{ padding: t.spacing.lg, gap: 6, borderBottomWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
                  <Text variant="bodyStrong" style={{ flex: 1 }}>{invite.customer_label}</Text>
                  <Text variant="captionStrong" color={invite.status === 'claimed' ? 'successText' : 'muted'}>{invite.status.toUpperCase()}</Text>
                </View>
                <Text variant="footnote" color="muted">{invite.category_name} · {formatINR(invite.total_paise)}</Text>
                {invite.status === 'open' ? (
                  <Button title="Cancel invite" variant="ghost" size="sm" onPress={() => void cancel(invite)} />
                ) : invite.booking_id ? (
                  <Button title="View booking" variant="ghost" size="sm" onPress={() => router.push({ pathname: '/booking/[id]', params: { id: invite.booking_id! } })} />
                ) : null}
              </View>
            ))}
          </Card>
        )}
      </Section>
      <Button title="Manage business staff" variant="outline" onPress={() => router.push('/merchant-staff')} />
    </Screen>
  );
}

function PriceRow({ label, amount, strong = false }: { label: string; amount: number; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text variant={strong ? 'bodyStrong' : 'callout'} color={strong ? 'text' : 'muted'} style={{ flex: 1 }}>{label}</Text>
      <Text variant={strong ? 'bodyStrong' : 'calloutStrong'}>{formatINR(amount)}</Text>
    </View>
  );
}
