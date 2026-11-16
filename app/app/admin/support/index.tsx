import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Badge, Card, EmptyState, Header, Screen, SegmentedControl, Text } from '../../../src/components/ui';
import { listAdminSupport, type AdminSupportThread } from '../../../src/lib/adminApi';

export default function AdminSupportInbox() {
  const [status, setStatus] = useState('open');
  const [rows, setRows] = useState<AdminSupportThread[]>([]);
  const load = useCallback(() => {
    void listAdminSupport(status).then(setRows).catch(() => setRows([]));
  }, [status]);
  useFocusEffect(load);
  return (
    <Screen header={<Header title="Support inbox" subtitle="Unread conversations first" />}>
      <SegmentedControl options={[{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }, { value: 'all', label: 'All' }]} value={status} onChange={setStatus} />
      {rows.length === 0 ? <EmptyState icon="chatbubbles-outline" title="Inbox clear" message="New customer and provider messages will appear here." /> : rows.map((r) => (
        <Card key={r.id} onPress={() => router.push({ pathname: '/admin/support/[id]', params: { id: r.id } })}>
          <Text variant="calloutStrong">{r.subject}</Text>
          <Text variant="footnote" color="textSecondary" numberOfLines={2}>{r.last_message}</Text>
          <Text variant="caption" color="muted">{r.user_name} · {r.is_provider ? 'Provider' : 'Customer'}</Text>
          <Badge label={r.admin_unread ? `${r.admin_unread} unread` : r.status} tone={r.admin_unread ? 'danger' : 'neutral'} />
        </Card>
      ))}
    </Screen>
  );
}
