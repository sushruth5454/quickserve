import { router } from 'expo-router';
import { Button, ErrorState, Header, InlineAlert, Screen, SkeletonCard, useConfirm, useToast } from '../../../components/ui';
import { getVenueBookingSections } from '../model';
import { useAppFeatureFlags } from '../../../lib/featureFlags';
import { useTheme } from '../../../theme';
import { createSportsVenueManagementActions } from './actions';
import {
  renderAssignedBookings,
  renderExistingBookings,
  renderOwnerManagementSections,
  renderVenueBookingLists,
} from './BookingSections';
import { renderResourceEditor } from './ResourceEditorSection';
import {
  renderOpeningHours,
  renderPriceRules,
  renderUnavailableTimes,
} from './ResourceScheduleSections';
import { renderVenueDetails, renderVenueSwitcher } from './VenueEditorSections';
import {
  getBookingsForVenue,
  getManagementLoadPresentation,
  getManagementScreenMode,
  useSportsVenueManagementState,
} from './useSportsVenueManagementState';

export default function SportsVenueManagementScreen() {
  const t = useTheme();
  const flags = useAppFeatureFlags();
  const toast = useToast();
  const confirm = useConfirm();
  const state = useSportsVenueManagementState();
  const actions = createSportsVenueManagementActions(state, toast, confirm);
  const venueBookings = state.enabled
    ? getBookingsForVenue(state.bookings, state.selectedId)
    : state.bookings;
  const loadPresentation = getManagementLoadPresentation(state.initialLoading, state.hasLoaded, state.error);
  const screenMode = getManagementScreenMode(state.enabled, state.selected?.venue ?? null, state.userId);
  const selectedIsOwner = screenMode === 'owner';
  const showCreateForm = state.isCreatingVenue || (state.hasLoaded && state.venues.length === 0);
  const venueOpsUxEnabled = flags.isOn('oorva_venue_ops_ux');

  return (
    <Screen header={<Header title="My sports venues" subtitle="Manage courts, hours, prices and requests" onBack={() => router.back()} />}>
      {loadPresentation === 'loading' ? (
        <SkeletonCard lines={4} />
      ) : loadPresentation === 'error' ? (
        <ErrorState message={state.error ?? 'Sports venues and bookings could not be loaded.'} onRetry={() => void state.load()} />
      ) : (
        <>
          {state.error ? (
            <>
              <InlineAlert message={state.error} />
              <Button title="Retry" variant="outline" onPress={() => void state.load()} disabled={state.busy} />
            </>
          ) : null}
          {screenMode === 'existing-bookings' ? (
            renderExistingBookings(state.bookings, null, t.spacing.sm)
          ) : (
            <>
              {screenMode === 'assigned' && state.selected ? (
                <>
                  {renderVenueSwitcher(state, t.spacing)}
                  {renderAssignedBookings(state.selected.venue.name, venueBookings, t.spacing.sm)}
                </>
              ) : selectedIsOwner && state.selectedId ? (
                renderOwnerManagementSections(
                  renderVenueSwitcher(state, t.spacing),
                  renderVenueBookingLists(getVenueBookingSections(venueBookings, new Date()), t.spacing.sm),
                  <>
                    {renderVenueDetails(state, actions, t.spacing)}
                    {renderResourceEditor(state, actions, t.spacing)}
                    {state.resourceId ? (
                      <>
                        {renderOpeningHours(state, actions, t.spacing)}
                        {renderPriceRules(state, actions, t.spacing)}
                        {renderUnavailableTimes(state, actions, t.spacing)}
                      </>
                    ) : null}
                  </>,
                  venueOpsUxEnabled,
                )
              ) : selectedIsOwner || showCreateForm ? (
                <>
                  {renderVenueSwitcher(state, t.spacing)}
                  {renderVenueDetails(state, actions, t.spacing)}
                </>
              ) : (
                renderVenueSwitcher(state, t.spacing)
              )}
            </>
          )}
        </>
      )}
    </Screen>
  );
}
