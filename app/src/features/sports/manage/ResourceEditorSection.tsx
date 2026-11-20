import { Pressable, View } from 'react-native';
import { Button, Card, Input, Text } from '../../../components/ui';
import type { SportsVenueManagementActions } from './actions';
import type { useSportsVenueManagementState } from './useSportsVenueManagementState';

type ManagementState = ReturnType<typeof useSportsVenueManagementState>;
type Spacing = { sm: number; xs: number; md: number };

export function renderResourceEditor(
  state: ManagementState,
  actions: SportsVenueManagementActions,
  spacing: Spacing,
) {
  return (
    <Card gap={spacing.sm}>
      <Text variant="title3">Courts and resources</Text>
      {state.resources.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${item.activity_name} resource ${item.name}, ${item.slot_minutes} minute slot`}
          onPress={() => {
            state.setResourceId(item.id);
            state.setActivityId(item.activity_id);
            state.setResourceName(item.name);
            state.setSlotMinutes(String(item.slot_minutes));
          }}
        >
          <Text variant="footnoteStrong" color={item.id === state.resourceId ? 'primaryText' : 'text'}>
            {item.activity_name} · {item.name} · {item.slot_minutes} min
          </Text>
        </Pressable>
      ))}
      <Text variant="subheadStrong">{state.resourceId ? 'Edit selected resource' : 'Add a resource'}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {state.activities.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={`Select activity ${item.name}`}
            onPress={() => state.setActivityId(item.id)}
          >
            <Card padding={spacing.sm} variant={item.id === state.activityId ? 'tinted' : 'outlined'}>
              <Text variant="captionStrong">{item.name}</Text>
            </Card>
          </Pressable>
        ))}
      </View>
      <Input label="Court/resource name" value={state.resourceName} onChangeText={state.setResourceName} maxLength={80} />
      <View style={{ gap: spacing.xs }}>
        <Text variant="footnoteStrong">Slot length</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {['30', '60', '90', '120'].map((minutes) => (
            <Button
              key={minutes}
              title={`${minutes} min`}
              variant={state.slotMinutes === minutes ? 'secondary' : 'outline'}
              size="sm"
              onPress={() => state.setSlotMinutes(minutes)}
            />
          ))}
        </View>
      </View>
      {state.settingsVisibility.canEditBookingMode ? (
        <View style={{ gap: spacing.xs }}>
          <Text variant="footnoteStrong">Booking mode</Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {(['approval', 'instant'] as const).map((mode) => (
              <Pressable
                key={mode}
                accessibilityRole="radio"
                accessibilityLabel={mode === 'instant' ? 'Instant booking' : 'Venue approval'}
                accessibilityState={{ checked: state.bookingMode === mode }}
                onPress={() => state.setBookingMode(mode)}
                style={{ flex: 1 }}
              >
                <Card padding={spacing.md} variant={state.bookingMode === mode ? 'tinted' : 'outlined'}>
                  <Text variant="footnoteStrong">{mode === 'instant' ? 'Instant booking' : 'Venue approval'}</Text>
                  <Text variant="caption" color="muted">
                    {mode === 'instant' ? 'Confirm available bookings right away.' : 'Review each request before confirming.'}
                  </Text>
                </Card>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <View style={{ gap: spacing.xs }}>
          <Text variant="footnoteStrong">Booking mode (read-only)</Text>
          <Text variant="caption" color="muted">
            Current setting: {state.selectedResource?.booking_mode === 'instant' ? 'Instant booking' : 'Venue approval'}.
            {' '}{state.selectedResource
              ? 'Instant booking is unavailable right now; saving other resource details preserves this setting.'
              : 'New resources use venue approval until instant booking is available.'}
          </Text>
        </View>
      )}
      {state.settingsVisibility.canEditCapacity ? (
        <Input
          label="Participant capacity (1–100)"
          value={state.capacity}
          onChangeText={state.setCapacity}
          keyboardType="number-pad"
        />
      ) : (
        <View style={{ gap: spacing.xs }}>
          <Text variant="footnoteStrong">Participant capacity (read-only)</Text>
          <Text variant="caption" color="muted">
            Current setting: {state.selectedResource?.capacity ?? 1}.
            {' '}{state.selectedResource
              ? 'Capacity editing is unavailable right now; saving other resource details preserves this setting.'
              : 'New resources use capacity 1 until capacity editing is available.'}
          </Text>
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button
          title="Save resource"
          onPress={() => void actions.saveResource()}
          loading={state.busy}
          disabled={state.busy || !state.activityId || (state.capacitySlotsEnabled && !state.capacityValid)}
          style={{ flex: 1 }}
        />
        <Button title="Add new" variant="outline" onPress={() => {
          state.setResourceId('');
          state.setResourceName('Court');
          state.setSlotMinutes('60');
          state.setBookingMode('approval');
          state.setCapacity('1');
        }} style={{ flex: 1 }} />
      </View>
    </Card>
  );
}
