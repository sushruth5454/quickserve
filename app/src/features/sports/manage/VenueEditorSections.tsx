import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Button, Card, Input, Text, TextArea } from '../../../components/ui';
import type { SportsVenueManagementActions } from './actions';
import type { useSportsVenueManagementState } from './useSportsVenueManagementState';

type ManagementState = ReturnType<typeof useSportsVenueManagementState>;
type Spacing = { sm: number; xs: number; md: number };

export function renderVenueSwitcher(state: ManagementState, spacing: Spacing) {
  return state.venues.length > 0 ? (
    <View style={{ gap: spacing.sm }}>
      <Text variant="subheadStrong">Your venues</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {state.venues.map((item) => (
          <Pressable key={item.venue.id} onPress={() => state.setSelectedId(item.venue.id)}>
            <Card padding={spacing.md} variant={item.venue.id === state.selectedId ? 'tinted' : 'outlined'}>
              <Text variant="footnoteStrong">{item.venue.name}</Text>
              <Text variant="caption" color="muted">{item.venue.status.toUpperCase()}</Text>
            </Card>
          </Pressable>
        ))}
      </View>
      <Button title="Create another venue" variant="outline" onPress={() => {
        state.setSelectedId('');
        state.setName('');
        state.setDescription('');
        state.setAddress(state.location.line1 ?? state.location.area);
        state.setCity(state.location.city);
        state.setArea(state.location.area);
        state.setLat(String(state.location.lat));
        state.setLng(String(state.location.lng));
        state.setAmenities('');
        state.setPhotos('');
        state.setResourceId('');
      }} />
      {state.selected?.venue.owner_id === state.userId ? (
        <Button title="Manage business staff" variant="outline" onPress={() => router.push('/merchant-staff')} />
      ) : null}
    </View>
  ) : null;
}

export function renderVenueDetails(state: ManagementState, actions: SportsVenueManagementActions, spacing: Spacing) {
  const { selected, paymentModes, settingsVisibility, busy, name } = state;
  return (
    <Card gap={spacing.sm}>
      <Text variant="title3">{selected ? 'Venue details' : 'Create a venue'}</Text>
      {selected ? (
        <Text variant="footnoteStrong" color={selected.venue.status === 'verified' ? 'successText' : 'muted'}>
          Status: {selected.venue.status.toUpperCase()}{selected.venue.status_reason ? ` · ${selected.venue.status_reason}` : ''}
        </Text>
      ) : null}
      <Input label="Venue name" value={state.name} onChangeText={state.setName} maxLength={120} />
      <TextArea label="Description" value={state.description} onChangeText={state.setDescription} maxLength={2000} />
      <Input label="Address" value={state.address} onChangeText={state.setAddress} maxLength={300} />
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Input label="City" value={state.city} onChangeText={state.setCity} maxLength={80} containerStyle={{ flex: 1 }} />
        <Input label="Area" value={state.area} onChangeText={state.setArea} maxLength={80} containerStyle={{ flex: 1 }} />
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Input label="Latitude" value={state.lat} onChangeText={state.setLat} keyboardType="decimal-pad" containerStyle={{ flex: 1 }} />
        <Input label="Longitude" value={state.lng} onChangeText={state.setLng} keyboardType="decimal-pad" containerStyle={{ flex: 1 }} />
      </View>
      <Input label="Amenities (comma separated)" value={state.amenities} onChangeText={state.setAmenities} placeholder="Parking, changing room" />
      <TextArea label="Photo URLs (one HTTPS URL per line)" value={state.photos} onChangeText={state.setPhotos} maxLength={3000} />
      {selected && settingsVisibility.showPaymentModes ? (
        <View style={{ gap: spacing.sm }}>
          <Text variant="subheadStrong">Accepted payment modes</Text>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: paymentModes.includes('pay_at_venue') }}
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
              accessibilityState={{ checked: paymentModes.includes('online'), disabled: !settingsVisibility.canSelectOnlinePayment }}
              disabled={!settingsVisibility.canSelectOnlinePayment}
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
              <Text variant="caption" color={selected?.payout_account_ready ? 'successText' : 'muted'}>
                Payout account: {selected?.payout_account_ready ? 'Ready' : 'Not ready'}
              </Text>
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
      <Button
        title={selected && settingsVisibility.showPaymentModes ? 'Save venue & payment settings' : 'Save venue details'}
        onPress={() => void actions.saveVenue()}
        loading={busy}
        disabled={busy || name.trim().length < 2}
      />
      {selected && selected.venue.status !== 'suspended' ? (
        <Button title="Submit for verification" variant="outline" onPress={() => void actions.submitVenue()} loading={busy} disabled={busy} />
      ) : null}
    </Card>
  );
}
