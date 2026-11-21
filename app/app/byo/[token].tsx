import { useLocalSearchParams } from 'expo-router';
import ByoDetailScreen from '../../src/features/platformScreens/ByoDetailScreen';

export default function ByoInviteRoute() {
  const { token } = useLocalSearchParams<{ token: string }>();
  return <ByoDetailScreen key={token} token={token} />;
}
