import { useLocalSearchParams } from 'expo-router';
import { SupportConversation } from '../../../src/components/SupportConversation';

export default function AdminSupportThread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SupportConversation threadId={id} admin />;
}
