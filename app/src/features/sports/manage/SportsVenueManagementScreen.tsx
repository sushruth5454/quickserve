import { router } from 'expo-router';
import { ErrorState, Header, InlineAlert, Screen, useToast } from '../../../components/ui';
import { getUpcomingVenueBookings } from '../model';
import { useTheme } from '../../../theme';
import { createSportsVenueManagementActions } from './actions';
import {
  renderAssignedBookings,
  renderExistingBookings,
  renderVenueBookingLists,
} from './BookingSections';
import { renderResourceEditor } from './ResourceEditorSection';
import {
  renderOpeningHours,
  renderPriceRules,
  renderUnavailableTimes,
} from './ResourceScheduleSections';
import { renderVenueDetails, renderVenueSwitcher } from './VenueEditorSections';
import { useSportsVenueManagementState } from './useSportsVenueManagementState';

export default function SportsVenueManagementScreen() {
  const t = useTheme();
  const toast = useToast();
  const state = useSportsVenueManagementState();
  const actions = createSportsVenueManagementActions(state, toast);
  const venueBookings = state.enabled
    ? state.bookings.filter((booking) => booking.owner_id === state.selected?.venue.owner_id && booking.venue_id === state.selectedId)
    : state.bookings;
  const myRequests = venueBookings.filter((booking) => booking.status === 'requested');
  const upcomingBookings = getUpcomingVenueBookings(venueBookings, new Date());

  if (state.selected && state.selected.venue.owner_id !== state.userId) {
    return renderAssignedBookings(state.selected.venue.name, venueBookings, t.spacing.sm);
  }

  return (
    <Screen header={<Header title="My sports venues" subtitle="Manage courts, hours, prices and requests" onBack={() => router.back()} />}>
      {!state.enabled ? (
        renderExistingBookings(state.bookings, state.error, t.spacing.sm)
      ) : state.error && state.venues.length === 0 ? (
        <ErrorState message={state.error} onRetry={() => void state.load()} />
      ) : (
        <>
          {state.error ? <InlineAlert message={state.error} /> : null}
          {renderVenueSwitcher(state, t.spacing)}
          {renderVenueDetails(state, actions, t.spacing)}
          {state.selectedId ? (
            <>
              {renderResourceEditor(state, actions, t.spacing)}
              {state.resourceId ? (
                <>
                  {renderOpeningHours(state, actions, t.spacing)}
                  {renderPriceRules(state, actions, t.spacing)}
                  {renderUnavailableTimes(state, actions, t.spacing)}
                </>
              ) : null}
              {renderVenueBookingLists(myRequests, upcomingBookings, t.spacing.sm)}
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}
