import { GuestGate } from '../../src/components/GuestGate';
import UnifiedActivityScreen from '../../src/features/activity/UnifiedActivityScreen';

export default function CustomerBookings() {
  return (
    <GuestGate returnTo="/bookings">
      <UnifiedActivityScreen />
    </GuestGate>
  );
}
