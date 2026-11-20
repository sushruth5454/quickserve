import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Badge, Card, ErrorState, Header, Input, Screen, SegmentedControl, Skeleton, Text, Button, useConfirm, useToast } from '../../src/components/ui';
import { listProviders, setProviderReview, setProviderSuspended, type AdminProvider } from '../../src/lib/adminApi';
import { formatPhone } from '../../src/lib/phone';
import { useTheme } from '../../src/theme';

const STATUS_TONE: Record<string, any> = {
  approved: 'success',
  rejected: 'danger',
  suspended: 'danger',
  pending: 'warning',
  needs_clarification: 'warning',
};

export default function AdminPeopleScreen() {
  const t = useTheme();
  const confirm = useConfirm();
  const toast = useToast();
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<AdminProvider[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const load = useCallback(() => {
    setError(null);
    void listProviders(filter, q || null).then(setRows).catch((e: Error) => setError(e.message));
  }, [filter, q]);
  useFocusEffect(load);
  const counts = useMemo(() => ({
    all: rows?.length ?? 0,
    creators: rows?.filter((p) => p.is_creator).length ?? 0,
    pending: rows?.filter((p) => p.submitted_at != null && ['pending', 'needs_clarification'].includes(p.admin_review_status)).length ?? 0,
  }), [rows]);

  const run = async (p: AdminProvider, action: 'approve' | 'reject' | 'clarify' | 'suspend' | 'restore') => {
    const reason = reasons[p.id] ?? '';
    if ((action === 'reject' || action === 'clarify') && !reason.trim()) {
      toast({ message: 'A reason is required.', tone: 'error' });
      return;
    }
    const title = action === 'suspend' ? `Suspend ${p.full_name}?`
      : action === 'restore' ? `Restore ${p.full_name}?`
        : action === 'approve' ? `Approve ${p.full_name}?`
          : action === 'clarify' ? `Ask ${p.full_name} for changes?`
            : `Reject ${p.full_name}?`;
    const message = action === 'suspend'
      ? 'They will be removed from matching and cannot take new work.'
      : action === 'restore'
        ? 'They can receive and accept new work again.'
        : action === 'approve'
          ? 'They will appear in search once their payout account is verified.'
          : action === 'clarify'
            ? 'The provider will see this reason as an action-needed note.'
            : 'This provider application will be rejected.';
    const confirmLabel = action === 'approve' ? 'Approve'
      : action === 'clarify' ? 'Ask for changes'
        : action === 'reject' ? 'Reject'
          : action === 'suspend' ? 'Suspend' : 'Restore';
    if (!await confirm({ title, message, confirmLabel, destructive: action === 'suspend' || action === 'reject' })) return;
    setSaving(`${p.id}:${action}`);
    try {
      if (action === 'suspend' || action === 'restore') {
        await setProviderSuspended(p.id, action === 'suspend', action === 'suspend' ? 'Suspended from admin portal' : 'Restored by admin');
      } else {
        const status = action === 'approve' ? 'approved' : action === 'clarify' ? 'needs_clarification' : 'rejected';
        await setProviderReview(p.id, status, action === 'approve' ? null : reason.trim());
        setReasons((current) => ({ ...current, [p.id]: '' }));
      }
      toast({ message: 'Saved', tone: 'success' });
      load();
    } catch (e) { toast({ message: (e as Error).message, tone: 'error' }); }
    finally { setSaving(null); }
  };

  return (
    <Screen header={<Header title="Providers & creators" subtitle={`${rows?.length ?? 0} results`} />}>
      <Button title="Audit log" variant="outline" onPress={() => router.push('/admin/audit')} />
      <Input label="Search" placeholder="Name, phone or city" value={q} onChangeText={setQ} />
      <SegmentedControl
        options={[{ value: 'all', label: `All ${counts.all || ''}` }, { value: 'creators', label: `Creators ${counts.creators || ''}` }, { value: 'pending', label: `Review ${counts.pending || ''}` }, { value: 'suspended', label: 'Suspended' }]}
        value={filter}
        onChange={setFilter}
      />
      {error ? <ErrorState message={error} onRetry={load} /> : !rows ? <Skeleton height={400} radius={t.radii.lg} /> : rows.map((p) => (
        <Card key={p.id} gap={t.spacing.md}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <View style={{ flex: 1, gap: 3 }}>
              <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                <Text variant="calloutStrong" style={{ flexShrink: 1 }}>{p.full_name || 'Unnamed provider'}</Text>
                {p.is_creator ? <Badge label="Creator" tone="info" /> : null}
              </View>
              <Text variant="caption" color="muted">{formatPhone(p.phone)} · {p.city || 'No city'}</Text>
              <Text variant="caption" color="muted">{p.categories.join(', ') || 'No active services'}</Text>
              <Text variant="caption" color="muted">
                Payout account: {p.has_payout_account ? p.kyc_status.replaceAll('_', ' ') : 'not set up'}
              </Text>
            </View>
            <Badge
              label={p.suspended ? 'Suspended' : p.paused ? 'On holiday' : p.admin_review_status.replaceAll('_', ' ')}
              tone={STATUS_TONE[p.suspended ? 'suspended' : p.admin_review_status] ?? (p.paused ? 'warning' : 'neutral')}
            />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="footnote" color="muted">★ {p.rating_avg || 'New'} · {p.jobs_completed} jobs</Text>
            <Text variant="footnote" color="muted">{p.is_online ? 'Online' : 'Offline'}</Text>
          </View>
          {p.submitted_at ? (
            <Input
              label="Reason (required for Reject or Ask for changes)"
              value={reasons[p.id] ?? ''}
              onChangeText={(value) => setReasons((current) => ({ ...current, [p.id]: value }))}
              maxLength={500}
            />
          ) : null}
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {p.submitted_at ? (
              <>
                <Button title="Approve" size="sm" loading={saving === `${p.id}:approve`} onPress={() => void run(p, 'approve')} />
                <Button title="Reject" size="sm" variant="outline" loading={saving === `${p.id}:reject`} onPress={() => void run(p, 'reject')} />
                <Button title="Ask for changes" size="sm" variant="outline" loading={saving === `${p.id}:clarify`} onPress={() => void run(p, 'clarify')} />
              </>
            ) : null}
            <Button
              title={p.suspended ? 'Restore' : 'Suspend'}
              size="sm"
              variant={p.suspended ? 'outline' : 'destructiveGhost'}
              loading={saving?.startsWith(p.id)}
              onPress={() => void run(p, p.suspended ? 'restore' : 'suspend')}
            />
          </View>
        </Card>
      ))}
    </Screen>
  );
}
