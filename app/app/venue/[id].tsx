import { useLocalSearchParams } from 'expo-router';
import { SportsVenueBookingScreen } from '../../src/features/sports/SportsVenueBookingScreen';

export default function SportsVenueScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SportsVenueBookingScreen venueId={id} />;
}
