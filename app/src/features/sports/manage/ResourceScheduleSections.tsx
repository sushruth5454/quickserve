import { View } from 'react-native';
import { Button, Card, Input, Text } from '../../../components/ui';
import { formatINR, rupeesToPaise } from '../../../lib/money';
import { supabase } from '../../../lib/supabase';
import { isSportsDateValid, isSportsTimeRangeValid } from '../model';
import type { SportsVenueManagementActions } from './actions';
import { slotLabel, WEEKDAYS } from './model';
import type { useSportsVenueManagementState } from './useSportsVenueManagementState';

type ManagementState = ReturnType<typeof useSportsVenueManagementState>;
type Spacing = { sm: number; xs: number };

export function renderOpeningHours(state: ManagementState, actions: SportsVenueManagementActions, spacing: Spacing) {
  return (
    <Card gap={spacing.sm}>
      <Text variant="title3">Opening hours</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {WEEKDAYS.map((day, index) => (
          <Button key={day} title={day.slice(0, 3)} size="sm" variant={state.weekday === String(index) ? 'secondary' : 'outline'} onPress={() => state.setWeekday(String(index))} />
        ))}
      </View>
      {state.closed ? (
        <Button title="Closed — tap to set hours" variant="outline" onPress={() => state.setClosed(false)} />
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Input label="Opens (24-hour time)" value={state.opens} onChangeText={state.setOpens} containerStyle={{ flex: 1 }} />
            <Input label="Closes (24-hour time)" value={state.closes} onChangeText={state.setCloses} containerStyle={{ flex: 1 }} />
          </View>
          <Button title="Set closed for this day" variant="ghost" onPress={() => {
            state.setClosed(true);
            void supabase.rpc('set_sports_hours', { p_venue_id: state.selectedId, p_weekday: Number(state.weekday), p_opens: null, p_closes: null }).then(({ error: rpcError }) => {
              if (rpcError) state.setError(rpcError.message);
              else void state.load();
            });
          }} />
        </>
      )}
      <Button title="Save opening hours" onPress={() => void actions.saveHours()} loading={state.busy} disabled={state.busy || state.closed || !isSportsTimeRangeValid(state.opens, state.closes)} />
      <View style={{ gap: 4 }}>
        {state.selected?.hours.map((row) => (
          <Text key={row.weekday} variant="caption" color="muted">{WEEKDAYS[row.weekday]} · {row.opens.slice(0, 5)}–{row.closes.slice(0, 5)}</Text>
        ))}
      </View>
    </Card>
  );
}

export function renderPriceRules(state: ManagementState, actions: SportsVenueManagementActions, spacing: Spacing) {
  return (
    <Card gap={spacing.sm}>
      <Text variant="title3">Prices (₹ per slot)</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        <Button title="Every day" size="sm" variant={state.priceDay === 'all' ? 'secondary' : 'outline'} onPress={() => state.setPriceDay('all')} />
        {WEEKDAYS.map((day, index) => (
          <Button key={day} title={day.slice(0, 3)} size="sm" variant={state.priceDay === String(index) ? 'secondary' : 'outline'} onPress={() => state.setPriceDay(String(index))} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Input label="From" value={state.priceStart} onChangeText={state.setPriceStart} containerStyle={{ flex: 1 }} />
        <Input label="Until" value={state.priceEnd} onChangeText={state.setPriceEnd} containerStyle={{ flex: 1 }} />
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Input label="Price" prefix="₹" value={state.priceRupees} onChangeText={state.setPriceRupees} keyboardType="decimal-pad" containerStyle={{ flex: 1 }} />
        <Input label="Label" value={state.priceLabel} onChangeText={state.setPriceLabel} containerStyle={{ flex: 1 }} />
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button
          title={state.editingPriceId ? 'Update price rule' : 'Add price rule'}
          onPress={() => void actions.savePrice()}
          loading={state.busy}
          disabled={state.busy || rupeesToPaise(Number(state.priceRupees)) <= 0 || !isSportsTimeRangeValid(state.priceStart, state.priceEnd)}
          style={{ flex: 1 }}
        />
        {state.editingPriceId ? (
          <Button
            title="Cancel edit"
            variant="outline"
            onPress={() => {
              state.setEditingPriceId(null);
              state.setPriceRupees('');
              state.setPriceLabel('Standard');
            }}
          />
        ) : null}
      </View>
      <View style={{ gap: 4 }}>
        {state.selected?.price_rules.filter((row) => row.resource_id === state.resourceId).map((row) => (
          <View key={row.id} style={{ gap: spacing.xs, paddingVertical: spacing.xs }}>
            <Text variant="caption" color="muted">
              {row.label} · {row.weekday == null ? 'Every day' : WEEKDAYS[row.weekday]} · {row.starts.slice(0, 5)}–{row.ends.slice(0, 5)} · {formatINR(row.price_paise)}
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              <Button
                title="Edit"
                variant="outline"
                size="sm"
                onPress={() => {
                  state.setEditingPriceId(row.id);
                  state.setPriceDay(row.weekday == null ? 'all' : String(row.weekday));
                  state.setPriceStart(row.starts.slice(0, 5));
                  state.setPriceEnd(row.ends.slice(0, 5));
                  state.setPriceRupees((row.price_paise / 100).toFixed(2));
                  state.setPriceLabel(row.label);
                }}
              />
              <Button title="Delete" variant="ghost" size="sm" onPress={() => void actions.deletePrice(row.id)} loading={state.busy} />
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}

export function renderUnavailableTimes(state: ManagementState, actions: SportsVenueManagementActions, spacing: Spacing) {
  return (
    <Card gap={spacing.sm}>
      <Text variant="title3">Unavailable times</Text>
      <Input label="Date (YYYY-MM-DD)" value={state.blockDate} onChangeText={state.setBlockDate} autoCapitalize="none" />
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Input label="From" value={state.blockStart} onChangeText={state.setBlockStart} containerStyle={{ flex: 1 }} />
        <Input label="Until" value={state.blockEnd} onChangeText={state.setBlockEnd} containerStyle={{ flex: 1 }} />
      </View>
      <Input label="Reason" value={state.blockReason} onChangeText={state.setBlockReason} maxLength={200} />
      <Button
        title="Block time"
        variant="outline"
        onPress={() => void actions.addBlock()}
        loading={state.busy}
        disabled={state.busy || !isSportsDateValid(state.blockDate) || !isSportsTimeRangeValid(state.blockStart, state.blockEnd)}
      />
      {state.selected?.blocks.filter((row) => row.resource_id === state.resourceId).map((row) => (
        <View key={row.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Text variant="caption" color="muted" style={{ flex: 1 }}>{slotLabel(row.starts_at)} · {row.reason || 'Unavailable'}</Text>
          <Button title="Remove" variant="ghost" size="sm" onPress={() => void actions.removeBlock(row.id)} />
        </View>
      ))}
    </Card>
  );
}
