import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, Share, View } from 'react-native';
import { Button, Card, EmptyState, ErrorState, Header, InlineAlert, Input, Screen, Section, Skeleton, Text, TextArea, useToast } from '../../components/ui';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import {
  cancelByoInvite,
  createByoInvite,
  listMyByoInvites,
  type ByoInviteResult,
  type ByoInviteSummary,
} from '../../lib/providerBusiness';
import { listMyServices } from '../../lib/api';
import { formatINR, rupeesToPaise } from '../../lib/money';
import { useTheme } from '../../theme';
import type { ProviderService } from '../../lib/types';

interface ReadState<T> {
  value: T[] | null;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
}

function initialReadState<T>(): ReadState<T> {
  return { value: null, error: null, loading: false, refreshing: false };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'This business information could not be loaded.';
}

function useProviderBusinessToolsController() {
  const toast = useToast();
  const flags = useAppFeatureFlags();
  const [services, setServices] = useState<ReadState<ProviderService>>(initialReadState);
  const [invites, setInvites] = useState<ReadState<ByoInviteSummary>>(initialReadState);
  const [serviceId, setServiceId] = useState('');
  const [customer, setCustomer] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [created, setCreated] = useState<ByoInviteResult | null>(null);
  const servicesRequest = useRef(0);
  const invitesRequest = useRef(0);

  const loadServices = useCallback(async () => {
    const request = ++servicesRequest.current;
    setServices((current) => ({
      ...current,
      loading: current.value === null,
      refreshing: current.value !== null,
    }));
    try {
      const value = await listMyServices();
      if (request !== servicesRequest.current) return;
      setServices({ value, error: null, loading: false, refreshing: false });
      setServiceId((current) => current || value[0]?.id || '');
    } catch (error) {
      if (request !== servicesRequest.current) return;
      setServices((current) => ({
        ...current,
        error: errorMessage(error),
        loading: false,
        refreshing: false,
      }));
    }
  }, []);

  const loadInvites = useCallback(async () => {
    const request = ++invitesRequest.current;
    setInvites((current) => ({
      ...current,
      loading: current.value === null,
      refreshing: current.value !== null,
    }));
    try {
      const value = await listMyByoInvites();
      if (request !== invitesRequest.current) return;
      setInvites({ value, error: null, loading: false, refreshing: false });
    } catch (error) {
      if (request !== invitesRequest.current) return;
      setInvites((current) => ({
        ...current,
        error: errorMessage(error),
        loading: false,
        refreshing: false,
      }));
    }
  }, []);

  const load = useCallback(async () => {
    await Promise.all([loadServices(), loadInvites()]);
  }, [loadInvites, loadServices]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const create = useCallback(async (amountPaise: number) => {
    const selectedService = services.value?.find((service) => service.id === serviceId);
    if (
      !selectedService
      || services.error
      || customer.trim().length < 2
      || !description.trim()
      || amountPaise <= 0
      || busy
    ) return;

    setBusy(true);
    setActionError(null);
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
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [busy, customer, description, load, serviceId, services.error, services.value]);

  const cancel = useCallback(async (invite: ByoInviteSummary) => {
    setActionError(null);
    try {
      await cancelByoInvite(invite.invite_id);
      await load();
      toast({ message: 'Invite cancelled' });
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }, [load, toast]);

  return {
    actionError,
    amount,
    busy,
    cancel,
    created,
    create,
    customer,
    description,
    invites,
    loadInvites,
    loadServices,
    merchantStaffEnabled: flags.isOn('merchant_staff'),
    serviceId,
    services,
    setAmount,
    setCustomer,
    setDescription,
    setServiceId,
  };
}

export default function ProviderBusinessToolsScreen() {
  const t = useTheme();
  const state = useProviderBusinessToolsController();
  const amountPaise = rupeesToPaise(Number(state.amount));
  const feePaise = Math.round(amountPaise * 0.03);
  const selectedService = state.services.value?.some((service) => service.id === state.serviceId) ?? false;
  const canCreate = selectedService
    && !state.services.error
    && state.customer.trim().length >= 2
    && state.description.trim().length > 0
    && amountPaise > 0;

  const share = async (url: string) => {
    await Share.share({
      title: 'Protected QuickServe booking',
      message: `Open your QuickServe booking invite:\n${url}\n\nNo phone number is included in this link.`,
    });
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
          {state.services.value === null && state.services.error ? (
            <ErrorState message={state.services.error} onRetry={() => void state.loadServices()} />
          ) : state.services.value === null ? (
            <Skeleton height={48} radius={t.radii.md} />
          ) : state.services.value.map((service) => {
            const selected = service.id === state.serviceId;
            return (
              <Pressable
                key={service.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => state.setServiceId(service.id)}
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
          {state.services.value?.length === 0 ? <Text variant="footnote" color="muted">Add a live service in your provider profile first.</Text> : null}
          {state.services.value !== null && state.services.refreshing ? <Text variant="caption" color="muted">Refreshing services…</Text> : null}
          {state.services.value !== null && state.services.error ? (
            <InlineAlert
              tone="warning"
              title="Showing the last successful service list"
              message={state.services.error}
              actionLabel="Retry"
              onAction={() => void state.loadServices()}
            />
          ) : null}
        </View>

        <Input
          label="Client name"
          placeholder="Client's first name"
          value={state.customer}
          onChangeText={state.setCustomer}
          maxLength={80}
          autoComplete="off"
          helper="Do not enter a phone number, email or payment handle."
        />
        <TextArea
          label="Agreed job"
          placeholder="Service and agreed scope"
          value={state.description}
          onChangeText={state.setDescription}
          maxLength={1000}
        />
        <Input
          label="Agreed amount"
          prefix="₹"
          placeholder="2500"
          value={state.amount}
          onChangeText={(value) => state.setAmount(value.replace(/[^\d.]/g, '').slice(0, 9))}
          keyboardType="decimal-pad"
        />

        {amountPaise > 0 ? (
          <View style={{ gap: 6 }}>
            <PriceRow label="Client pays for the job" amount={amountPaise} />
            <PriceRow label="3% QuickServe tools fee" amount={feePaise} />
            <PriceRow label="Total" amount={amountPaise + feePaise} strong />
          </View>
        ) : null}

        <InlineAlert message={state.actionError} />
        <Button
          title="Create secure invite"
          onPress={() => void state.create(amountPaise)}
          loading={state.busy}
          disabled={!canCreate}
          fullWidth
          leftIcon="link-outline"
        />
      </Card>

      {state.created ? (
        <Card gap={t.spacing.md}>
          <Text variant="title3">Invite ready</Text>
          <Text variant="callout" color="muted">The secure token expires in 7 days. It cannot be recovered here after you leave this screen.</Text>
          <Button title="Share invite" onPress={() => void share(state.created!.share_url)} leftIcon="share-outline" fullWidth />
        </Card>
      ) : null}

      <Section title="Recent invites">
        {state.invites.value === null && state.invites.error ? (
          <ErrorState message={state.invites.error} onRetry={() => void state.loadInvites()} />
        ) : state.invites.value === null ? (
          <Skeleton height={76} radius={t.radii.lg} />
        ) : (
          <>
            {state.invites.refreshing ? <Text variant="caption" color="muted">Refreshing invites…</Text> : null}
            {state.invites.error ? (
              <InlineAlert
                tone="warning"
                title="Showing the last successful invite list"
                message={state.invites.error}
                actionLabel="Retry"
                onAction={() => void state.loadInvites()}
              />
            ) : null}
            {state.invites.value.length === 0 ? (
              <EmptyState icon="link-outline" title="No client invites yet" message="Create an invite when an existing client wants to pay safely in QuickServe." compact />
            ) : (
              <Card padding={0} gap={0}>
                {state.invites.value.map((invite) => (
                  <View key={invite.invite_id} style={{ padding: t.spacing.lg, gap: 6, borderBottomWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
                      <Text variant="bodyStrong" style={{ flex: 1 }}>{invite.customer_label}</Text>
                      <Text variant="captionStrong" color={invite.status === 'claimed' ? 'successText' : 'muted'}>{invite.status.toUpperCase()}</Text>
                    </View>
                    <Text variant="footnote" color="muted">{invite.category_name} · {formatINR(invite.total_paise)}</Text>
                    {invite.status === 'open' ? (
                      <Button title="Cancel invite" variant="ghost" size="sm" onPress={() => void state.cancel(invite)} />
                    ) : invite.booking_id ? (
                      <Button title="View booking" variant="ghost" size="sm" onPress={() => router.push({ pathname: '/booking/[id]', params: { id: invite.booking_id! } })} />
                    ) : null}
                  </View>
                ))}
              </Card>
            )}
          </>
        )}
      </Section>
      {state.merchantStaffEnabled ? (
        <Button title="Manage business staff" variant="outline" onPress={() => router.push('/merchant-staff')} />
      ) : null}
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
