import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Badge, Button, Card, Input, Text, TextArea, useConfirm } from '../../../components/ui';
import type { SportsVenueManagementActions } from './actions';
import type { useSportsVenueManagementState } from './useSportsVenueManagementState';
import { getVenueReviewPresentation } from '../venueReviewPresentation';

type ManagementState = ReturnType<typeof useSportsVenueManagementState>;
type Spacing = { sm: number; xs: number; md: number };

export function renderVenueSwitcher(state: ManagementState, spacing: Spacing) {
  return state.venues.length > 0 ? (
    <View style={{ gap: spacing.sm }}>
      <Text variant="subheadStrong">Your venues</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {state.venues.map((item) => (
          <Pressable
            key={item.venue.id}
            accessibilityRole="button"
            accessibilityLabel={`Select venue ${item.venue.name}, ${item.venue.status}`}
            accessibilityState={{ selected: item.venue.id === state.selectedId }}
            onPress={() => state.setSelectedId(item.venue.id)}
          >
            <Card padding={spacing.md} variant={item.venue.id === state.selectedId ? 'tinted' : 'outlined'}>
              <Text variant="footnoteStrong">{item.venue.name}</Text>
              <Badge
                label={item.venue.status.toUpperCase()}
                tone={item.venue.status === 'verified' ? 'success' : 'neutral'}
              />
            </Card>
          </Pressable>
        ))}
      </View>
      {state.selected?.venue.owner_id === state.userId ? (
        <>
          <Button title="Create another venue" variant="outline" onPress={state.startNewVenue} />
          <Button title="Manage business staff" variant="outline" onPress={() => router.push('/merchant-staff')} />
        </>
      ) : null}
    </View>
  ) : null;
}

export function renderVenueDetails(state: ManagementState, actions: SportsVenueManagementActions, spacing: Spacing) {
  return <VenueDetailsEditor state={state} actions={actions} spacing={spacing} />;
}

function VenueDetailsEditor({ state, actions, spacing }: {
  state: ManagementState;
  actions: SportsVenueManagementActions;
  spacing: Spacing;
}) {
  const confirm = useConfirm();
  const { selected, paymentModes, settingsVisibility, busy, name } = state;
  const isOwner = selected?.venue.owner_id === state.userId;
  const review = selected
    ? getVenueReviewPresentation(selected.venue.status, isOwner ? 'owner' : 'member')
    : null;
  const canEditDetails = !selected || review?.canEditDetails === true;
  return (
    <Card gap={spacing.sm}>
      <Text variant="title3">{selected ? 'Venue details' : 'Create a venue'}</Text>
      {selected ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs }}>
          <Text variant="footnoteStrong" color={selected.venue.status === 'verified' ? 'successText' : 'muted'}>
            Status:
          </Text>
          <Badge
            label={review?.statusLabel ?? selected.venue.status.toUpperCase()}
            tone={selected.venue.status === 'verified' ? 'success' : 'neutral'}
          />
          {selected.venue.status_reason ? (
            <Text variant="footnoteStrong" color={selected.venue.status === 'verified' ? 'successText' : 'muted'}>
              · {selected.venue.status_reason}
            </Text>
          ) : null}
        </View>
      ) : null}
      <Input label="Venue name" value={state.name} onChangeText={state.setName} maxLength={120} editable={canEditDetails} />
      <TextArea label="Description" value={state.description} onChangeText={state.setDescription} maxLength={2000} editable={canEditDetails} />
      <Input label="Address" value={state.address} onChangeText={state.setAddress} maxLength={300} editable={canEditDetails} />
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Input label="City" value={state.city} onChangeText={state.setCity} maxLength={80} editable={canEditDetails} containerStyle={{ flex: 1 }} />
        <Input label="Area" value={state.area} onChangeText={state.setArea} maxLength={80} editable={canEditDetails} containerStyle={{ flex: 1 }} />
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Input label="Latitude" value={state.lat} onChangeText={state.setLat} keyboardType="decimal-pad" editable={canEditDetails} containerStyle={{ flex: 1 }} />
        <Input label="Longitude" value={state.lng} onChangeText={state.setLng} keyboardType="decimal-pad" editable={canEditDetails} containerStyle={{ flex: 1 }} />
      </View>
      <Input label="Amenities (comma separated)" value={state.amenities} onChangeText={state.setAmenities} placeholder="Parking, changing room" editable={canEditDetails} />
      <TextArea label="Photo URLs (one HTTPS URL per line)" value={state.photos} onChangeText={state.setPhotos} maxLength={3000} editable={canEditDetails} />
      {selected && settingsVisibility.showPaymentModes ? (
        <View style={{ gap: spacing.sm }}>
          <Text variant="subheadStrong">Accepted payment modes</Text>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel="Pay at venue"
            accessibilityState={{ checked: paymentModes.includes('pay_at_venue'), disabled: !canEditDetails }}
            disabled={!canEditDetails}
            onPress={() => actions.togglePaymentMode('pay_at_venue')}
          >
            <Card padding={spacing.md} variant={paymentModes.includes('pay_at_venue') ? 'tinted' : 'outlined'}>
              <Text variant="footnoteStrong">Pay at venue</Text>
            </Card>
          </Pressable>
          {!settingsVisibility.showOnlinePaymentOption ? (
            <View style={{ gap: spacing.xs }}>
              <Text variant="footnoteStrong">Online payment (read-only)</Text>
              <Text variant="caption" color="muted">
                {selected.venue.payment_modes?.includes('online')
                  ? 'Online payment is configured but unavailable to edit right now. Saving venue details preserves this setting.'
                  : 'Online payment cannot be selected while the feature is unavailable.'}
              </Text>
            </View>
          ) : null}
          {settingsVisibility.showOnlinePaymentOption ? (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel="Pay online"
              accessibilityState={{ checked: paymentModes.includes('online'), disabled: !settingsVisibility.canSelectOnlinePayment }}
              disabled={!canEditDetails || !settingsVisibility.canSelectOnlinePayment}
              onPress={() => actions.togglePaymentMode('online')}
            >
              <Card padding={spacing.md} variant={paymentModes.includes('online') ? 'tinted' : 'outlined'}>
                <Text variant="footnoteStrong">Pay online</Text>
                {!settingsVisibility.canSelectOnlinePayment ? (
                  <Text variant="caption" color="muted">Available after the venue owner’s payout account is verified.</Text>
                ) : null}
              </Card>
            </Pressable>
          ) : null}
          {settingsVisibility.showPayoutStatus ? (
            <View style={{ gap: spacing.xs }}>
              <Badge
                label={`Payout account: ${selected?.payout_account_ready ? 'Ready' : 'Not ready'}`}
                tone={selected?.payout_account_ready ? 'success' : 'neutral'}
              />
              {settingsVisibility.showPayoutSetup ? (
                <Button
                  title="Set up payout account"
                  variant="outline"
                  onPress={() => router.push({
                    pathname: '/provider-profile/[section]',
                    params: { section: 'payouts', returnTo: 'hub' },
                  })}
                />
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
      {canEditDetails ? (
        <Button
          title={selected && settingsVisibility.showPaymentModes ? 'Save venue & payment settings' : 'Save venue details'}
          onPress={() => void actions.saveVenue(confirm)}
          loading={busy}
          disabled={busy || name.trim().length < 2}
        />
      ) : null}
      {review?.actions.some((action) => action.kind === 'submit') ? (
        <Button
          title="Submit for verification"
          variant="outline"
          onPress={() => void actions.submitVenue()}
          loading={busy}
          disabled={busy}
        />
      ) : null}
    </Card>
  );
}
