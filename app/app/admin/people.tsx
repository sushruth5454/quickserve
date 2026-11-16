import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Badge, Card, ErrorState, Header, Input, Screen, SegmentedControl, Skeleton, Text, Button, useConfirm, useToast } from '../../src/components/ui';
import { listProviders, setProviderKyc, setProviderSuspended, type AdminProvider } from '../../src/lib/adminApi';
import { formatPhone } from '../../src/lib/phone';
import { useTheme } from '../../src/theme';

const STATUS_TONE: Record<string, any> = {
  verified: 'success',
  rejected: 'danger',
  suspended: 'danger',
  under_review: 'warning',
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
  const load = useCallback(() => {
    setError(null);
    void listProviders(filter, q || null).then(setRows).catch((e: Error) => setError(e.message));
  }, [filter, q]);
  useFocusEffect(load);
  const counts = useMemo(() => ({
    all: rows?.length ?? 0,
    creators: rows?.filter((p) => p.is_creator).length ?? 0,
    pending: rows?.filter((p) => ['pending', 'under_review', 'needs_clarification'].includes(p.kyc_status)).length ?? 0,
  }), [rows]);

  const run = async (p: AdminProvider, action: 'verify' | 'reject' | 'suspend' | 'restore') => {
    const title = action === 'suspend' ? `Suspend ${p.full_name}?` : action === 'restore' ? `Restore ${p.full_name}?` : action === 'verify' ? `Verify ${p.full_name}?` : `Reject ${p.full_name}?`;
    const message = action === 'suspend'
      ? 'They will be removed from matching and cannot take new work.'
      : action === 'restore'
        ? 'They can receive and accept new work again.'
        : action === 'verify'
          ? 'Their submitted documents will be marked verified.'
          : 'They will need to fix their details and submit again.';
    if (!await confirm({ title, message, confirmLabel: action === 'verify' ? 'Verify' : action === 'reject' ? 'Reject' : action === 'suspend' ? 'Suspend' : 'Restore', destructive: action === 'suspend' || action === 'reject' })) return;
    setSaving(`${p.id}:${action}`);
    try {
      if (action === 'suspend' || action === 'restore') {
        await setProviderSuspended(p.id, action === 'suspend', action === 'suspend' ? 'Suspended from admin portal' : 'Restored by admin');
      } else {
        await setProviderKyc(p.id, action === 'verify' ? 'verified' : 'rejected', action === 'reject' ? 'Rejected after admin review' : null);
      }
      toast({ message: 'Saved', tone: 'success' });
      load();
    } catch (e) { toast({ message: (e as Error).message, tone: 'error' }); }
    finally { setSaving(null); }
  };

  return (
    <Screen header={<Header title="Providers & creators" subtitle={`${rows?.length ?? 0} results`} />}>
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
            </View>
            <Badge
              label={p.suspended ? 'Suspended' : p.paused ? 'On holiday' : p.kyc_status.replace('_', ' ')}
              tone={STATUS_TONE[p.suspended ? 'suspended' : p.kyc_status] ?? (p.paused ? 'warning' : 'neutral')}
            />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="footnote" color="muted">★ {p.rating_avg || 'New'} · {p.jobs_completed} jobs</Text>
            <Text variant="footnote" color="muted">{p.is_online ? 'Online' : 'Offline'}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {p.kyc_status !== 'verified' ? <Button title="Verify" size="sm" loading={saving === `${p.id}:verify`} onPress={() => void run(p, 'verify')} /> : null}
            {!['rejected', 'suspended'].includes(p.kyc_status) && !p.suspended ? <Button title="Reject" size="sm" variant="outline" loading={saving === `${p.id}:reject`} onPress={() => void run(p, 'reject')} /> : null}
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
