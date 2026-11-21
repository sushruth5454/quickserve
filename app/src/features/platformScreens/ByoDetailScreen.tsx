import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Header, InlineAlert, Input, Screen, Skeleton, Text, useToast } from '../../components/ui';
import { claimByoInvite, previewByoInvite, type ByoInvitePreview } from '../../lib/providerBusiness';
import { useAuth } from '../../lib/auth';
import { useSelectedLocation } from '../../lib/locationContext';
import { formatINR } from '../../lib/money';
import { usePayment } from '../../lib/payments';
import {
  byoInviteAction,
  commitByoInviteClaim,
  failByoInviteClaim,
  failByoInvitePreview,
  loadingByoInvite,
  recordByoPaymentIssue,
  resolveByoInvitePreview,
  startByoPayment,
  type ByoInvitePresentation,
} from '../../lib/byoInvitePresentation';
import { useTheme } from '../../theme';

export default function ByoDetailScreen({ token }: { token: string }) {
  const t = useTheme();
  const { userId, presentation, address, city, claimBusy, paymentBusy, actionError, setAddress, setCity, retryPreview, claim, retryPayment } =
    useByoDetailController(token);
  const action = byoInviteAction(presentation, token, Boolean(userId));
  const preview = presentation.status === 'available' || presentation.status === 'claimed'
    ? presentation.preview
    : null;

  return (
    <Screen
      header={<Header title="Protected client booking" onBack={() => router.canGoBack() ? router.back() : router.replace('/')} />}
      gap={t.spacing.xl}
      footer={
        action === 'claim' && preview ? (
          <Button
            title={`Accept & pay ${formatINR(preview.total_paise)}`}
            onPress={() => void claim()}
            loading={claimBusy}
            disabled={!address.trim() || !city.trim()}
            size="lg"
            fullWidth
            leftIcon="lock-closed"
          />
        ) : action === 'sign-in' ? (
          <Button
            title="Log in to accept this booking"
            onPress={() => router.push({ pathname: '/login', params: { inviteToken: token } })}
            size="lg"
            fullWidth
            leftIcon="log-in-outline"
          />
        ) : action === 'recover' && presentation.status === 'claimed' ? (
          <View style={{ gap: t.spacing.sm }}>
            <Button
              title="View booking"
              variant="secondary"
              onPress={() => router.push({ pathname: '/booking/[id]', params: { id: presentation.bookingId } })}
              fullWidth
            />
            <Button
              title="Retry payment"
              onPress={() => void retryPayment()}
              loading={paymentBusy}
              disabled={paymentBusy}
              size="lg"
              fullWidth
              leftIcon="lock-closed"
            />
          </View>
        ) : undefined
      }
    >
      {presentation.status === 'loading' ? (
        <View style={{ gap: t.spacing.md }}><Skeleton width="70%" height={28} /><Skeleton width="100%" height={140} /></View>
      ) : presentation.status === 'error' ? (
        <View style={{ gap: t.spacing.md }}>
          <InlineAlert
            tone="danger"
            title={presentation.reason === 'claim' ? 'Could not confirm this booking' : "Couldn't load this invite"}
            message={presentation.message}
          />
          <Button title={presentation.reason === 'claim' ? 'Refresh invite' : 'Retry'} onPress={() => void retryPreview()} />
        </View>
      ) : presentation.status === 'unavailable' ? (
        <InlineAlert tone="danger" title="Invite unavailable" message="This booking link is invalid, expired or already used." />
      ) : (
        <>
          <Card gap={t.spacing.md}>
            <Text variant="overline" color="primaryText">QUICKSERVE PROTECTED BOOKING</Text>
            <Text variant="title2">{preview!.category_name}</Text>
            <Text variant="body" color="textSecondary">{preview!.description}</Text>
            <View style={{ height: 1, backgroundColor: t.colors.border }} />
            <PriceRow label="Provider" value={preview!.provider_name} />
            <PriceRow label="Client" value={preview!.customer_label} />
            {preview!.scheduled_at ? <PriceRow label="Scheduled" value={new Date(preview!.scheduled_at).toLocaleString('en-IN')} /> : null}
            <PriceRow label="Agreed job" value={formatINR(preview!.amount_paise)} />
            <PriceRow label="3% tools fee" value={formatINR(preview!.fee_paise)} />
            <PriceRow label="Total" value={formatINR(preview!.total_paise)} total />
          </Card>

          <InlineAlert
            tone="success"
            icon="shield-checkmark-outline"
            title="Protected by QuickServe"
            message="Pay in-app, confirm work with a completion code, and qualify for the guarantee and a verified review."
          />

          {userId && presentation.status === 'available' ? (
            <Card gap={t.spacing.lg}>
              <Text variant="title3">Where should the provider come?</Text>
              <Input label="Address" placeholder="Flat, building and street" value={address} onChangeText={setAddress} autoComplete="street-address" />
              <Input label="City" value={city} onChangeText={setCity} autoComplete="postal-address-locality" />
              <Text variant="caption" color="muted">Your address is shared with this provider only after the booking is paid. No phone number is included.</Text>
            </Card>
          ) : !userId ? (
            <Text variant="callout" color="muted" align="center">The provider never sees or receives your phone number through this invite.</Text>
          ) : null}

          {presentation.status === 'claimed' ? (
            <InlineAlert
              tone={presentation.paymentStatus === 'error' ? 'danger' : 'success'}
              title="Booking saved"
              message={
                presentation.paymentStatus === 'error'
                  ? `Payment needs attention. ${presentation.paymentError ?? ''}`.trim()
                  : presentation.paymentStatus === 'cancelled'
                    ? 'Payment was not completed. You can retry payment or view your booking.'
                    : 'Your booking is saved. Complete payment or view your booking.'
              }
            />
          ) : null}
        </>
      )}
      <InlineAlert message={actionError} />
    </Screen>
  );
}

interface ByoDetailController {
  userId: string | null;
  presentation: ByoInvitePresentation<ByoInvitePreview>;
  address: string;
  city: string;
  claimBusy: boolean;
  paymentBusy: boolean;
  actionError: string | null;
  setAddress: (value: string) => void;
  setCity: (value: string) => void;
  retryPreview: () => void;
  claim: () => Promise<void>;
  retryPayment: () => Promise<void>;
}

function useByoDetailController(token: string): ByoDetailController {
  const { userId, setActiveRole } = useAuth();
  const { location, coords } = useSelectedLocation();
  const pay = usePayment();
  const toast = useToast();
  const [presentation, setPresentation] = useState<ByoInvitePresentation<ByoInvitePreview>>(
    () => loadingByoInvite(token, 0),
  );
  const [address, setAddress] = useState(location.line1 ?? '');
  const [city, setCity] = useState(location.city);
  const [claimBusy, setClaimBusy] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const currentToken = useRef(token);
  const requestId = useRef(0);
  const claimStartedFor = useRef<string | null>(null);
  currentToken.current = token;

  const retryPreview = useCallback(() => {
    const id = ++requestId.current;
    setPresentation(loadingByoInvite(token, id));
    setActionError(null);
    if (!token) {
      setPresentation((current) => resolveByoInvitePreview(current, token, id, null));
      return;
    }

    void previewByoInvite(token)
      .then((preview) => {
        if (currentToken.current !== token || requestId.current !== id) return;
        setPresentation((current) => resolveByoInvitePreview(current, token, id, preview));
      })
      .catch((error: unknown) => {
        if (currentToken.current !== token || requestId.current !== id) return;
        const message = error instanceof Error ? error.message : 'Could not load this invite.';
        setPresentation((current) => failByoInvitePreview(current, token, id, message));
      });
  }, [token]);

  useEffect(() => {
    retryPreview();
    return () => {
      requestId.current += 1;
    };
  }, [retryPreview]);

  const visiblePresentation = presentation.token === token
    ? presentation
    : loadingByoInvite<ByoInvitePreview>(token, requestId.current);

  const startPaymentForBooking = useCallback(async (
    bookingId: string,
    requestToken: string,
  ) => {
    setPaymentBusy(true);
    setPresentation((current) => startByoPayment(current, requestToken, bookingId));
    try {
      const result = await pay(bookingId);
      if (result === 'cancelled') {
        setPresentation((current) => recordByoPaymentIssue(current, requestToken, bookingId, { status: 'cancelled' }));
        return;
      }
      if (currentToken.current !== requestToken) return;
      router.replace({ pathname: '/booking/[id]', params: { id: bookingId } });
      toast({ message: 'Booking created — complete payment to confirm it.' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not start payment.';
      setPresentation((current) => recordByoPaymentIssue(current, requestToken, bookingId, { status: 'error', message }));
    } finally {
      setPaymentBusy(false);
    }
  }, [pay, toast]);

  const claim = useCallback(async () => {
    const current = presentation.token === token
      ? presentation
      : loadingByoInvite<ByoInvitePreview>(token, requestId.current);
    if (byoInviteAction(current, token, Boolean(userId)) !== 'claim' || claimStartedFor.current === token) return;
    if (!address.trim() || !city.trim()) {
      setActionError('Enter the service address before accepting the booking.');
      return;
    }

    claimStartedFor.current = token;
    setClaimBusy(true);
    setActionError(null);
    try {
      const bookingId = await claimByoInvite(token, {
        label: 'Booking',
        line1: address.trim(),
        city: city.trim(),
        lat: coords.lat,
        lng: coords.lng,
      });
      setPresentation((state) => commitByoInviteClaim(state, token, current.requestId, bookingId));
      setActiveRole('customer');
      await startPaymentForBooking(bookingId, token);
    } catch (error: unknown) {
      if (currentToken.current === token) {
        const message = error instanceof Error ? error.message : 'Could not accept this booking.';
        setPresentation((state) => failByoInviteClaim(state, token, current.requestId, message));
        claimStartedFor.current = null;
      }
    } finally {
      setClaimBusy(false);
    }
  }, [address, city, coords.lat, coords.lng, presentation, setActiveRole, startPaymentForBooking, token, userId]);

  const retryPayment = useCallback(async () => {
    const current = presentation.token === token ? presentation : null;
    if (!current || current.status !== 'claimed' || paymentBusy) return;
    await startPaymentForBooking(current.bookingId, token);
  }, [paymentBusy, presentation, startPaymentForBooking, token]);

  return {
    userId,
    presentation: visiblePresentation,
    address,
    city,
    claimBusy,
    paymentBusy,
    actionError,
    setAddress,
    setCity,
    retryPreview,
    claim,
    retryPayment,
  };
}

function PriceRow({ label, value, total = false }: { label: string; value: string; total?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 8 }}>
      <Text variant={total ? 'bodyStrong' : 'callout'} color={total ? undefined : 'muted'} style={{ flex: 1, minWidth: 0 }}>{label}</Text>
      <Text variant={total ? 'title3' : 'calloutStrong'} style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>{value}</Text>
    </View>
  );
}
