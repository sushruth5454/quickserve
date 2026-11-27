import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { Badge, Button, Card, EmptyState, ErrorState, Header, Input, Screen, SegmentedControl, Skeleton, Text, useConfirm, useToast } from '../../components/ui';
import { listProviders, setProviderReview, setProviderSuspended, type AdminProvider } from '../../lib/adminApi';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import { providerReviewActions, type ProviderReviewAction } from '../adminPeople/model';
import { formatPhone } from '../../lib/phone';
import { useTheme } from '../../theme';

const STATUS_TONE: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = {
  approved: 'success',
  rejected: 'danger',
  suspended: 'danger',
  pending: 'warning',
  needs_clarification: 'warning',
};

function reviewLabel(action: ProviderReviewAction): string {
  if (action === 'clarify') return 'Ask for changes';
  return action === 'approve' ? 'Approve' : 'Reject';
}

function reviewTarget(action: ProviderReviewAction) {
  return action === 'approve' ? 'approved' : action === 'clarify' ? 'needs_clarification' : 'rejected';
}

function remainingGateContext(provider: AdminProvider): string {
  const readiness = provider.go_live;
  const reasons = readiness?.reasons
    .filter((reason) => reason.severity === 'action')
    .map((reason) => reason.detail?.trim() || reason.code.replaceAll('_', ' ')) ?? [];
  const readinessText = readiness
    ? `Current server go-live state: ${readiness.state.replaceAll('_', ' ')}${reasons.length ? `; remaining requirements: ${reasons.join('; ')}` : ''}.`
    : 'Current server go-live readiness is unavailable.';
  return `Payout verification and go-live readiness are separate from admin review. ${readinessText}`;
}

export default function AdminPeopleScreen() {
  const t = useTheme();
  const flags = useAppFeatureFlags();
  const queueFirstCompositionEnabled = flags.isOn('oorva_admin_ops_ux');
  const confirm = useConfirm();
  const toast = useToast();
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<AdminProvider[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingIds, setSavingIds] = useState<Set<string>>(() => new Set());
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const requestSequence = useRef(0);
  const operationLocks = useRef(new Set<string>());
  const searchState = useRef({ filter, q });
  searchState.current = { filter, q };

  const load = useCallback(async () => {
    const request = ++requestSequence.current;
    const currentSearch = searchState.current;
    setError(null);
    setRows(null);
    try {
      const result = await listProviders(currentSearch.filter, currentSearch.q || null);
      if (request !== requestSequence.current) return null;
      setRows(result);
      return null;
    } catch (e) {
      if (request !== requestSequence.current) return null;
      const message = e instanceof Error ? e.message : 'Provider list could not be loaded.';
      setError(message);
      return message;
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load, filter, q]));

  const run = async (provider: AdminProvider, action: ProviderReviewAction | 'suspend' | 'restore') => {
    if (operationLocks.current.has(provider.id)) return;
    const reason = reasons[provider.id] ?? '';
    if ((action === 'reject' || action === 'clarify') && !reason.trim()) {
      toast({ message: 'A reason is required.', tone: 'error' });
      return;
    }

    const title = action === 'suspend' ? `Suspend ${provider.full_name}?`
      : action === 'restore' ? `Clear suspension for ${provider.full_name}?`
        : action === 'approve' ? `Approve ${provider.full_name}?`
          : action === 'clarify' ? `Ask ${provider.full_name} for changes?`
            : `Reject ${provider.full_name}?`;
    const message = action === 'suspend'
      ? 'This sets admin suspension. Review state, payout status, and provider availability remain separate.'
      : action === 'restore'
        ? 'This clears admin suspension only. Provider pause, online preference, payout verification, and go-live requirements remain separate.'
        : action === 'approve'
          ? `This changes only admin review status. ${remainingGateContext(provider)}`
          : action === 'clarify'
            ? 'The provider will see this reason as an action-needed note. Payout and go-live status are unchanged.'
            : action === 'reject'
              ? 'This changes only admin review status. Payout and go-live status are unchanged.'
              : '';
    operationLocks.current.add(provider.id);
    setSavingIds((current) => new Set(current).add(provider.id));
    try {
      const confirmed = await confirm({
        title,
        message,
        confirmLabel: action === 'approve' ? 'Approve'
          : action === 'clarify' ? 'Ask for changes'
            : action === 'reject' ? 'Reject'
              : action === 'suspend' ? 'Suspend' : 'Restore',
        destructive: action === 'suspend' || action === 'reject',
      });
      if (!confirmed) return;

      if (action === 'suspend' || action === 'restore') {
        await setProviderSuspended(
          provider.id,
          action === 'suspend',
          action === 'suspend' ? 'Suspended from admin portal' : 'Restored by admin',
        );
      } else {
        await setProviderReview(provider.id, reviewTarget(action), action === 'approve' ? null : reason.trim() || null);
        setReasons((current) => ({ ...current, [provider.id]: '' }));
      }
      const refreshError = await load();
      toast({
        message: refreshError ? `Saved, but provider list refresh failed: ${refreshError}` : 'Saved',
        tone: refreshError ? 'error' : 'success',
      });
    } catch (e) {
      const actionError = e instanceof Error ? e.message : 'Provider update was rejected.';
      const refreshError = await load();
      toast({
        message: refreshError ? `${actionError} Provider list refresh failed: ${refreshError}` : actionError,
        tone: 'error',
      });
    } finally {
      operationLocks.current.delete(provider.id);
      setSavingIds((current) => {
        const next = new Set(current);
        next.delete(provider.id);
        return next;
      });
    }
  };

  const auditLogShortcut = (
    <Button title="Audit log" variant="outline" onPress={() => router.push('/admin/audit')} />
  );

  return (
    <Screen header={<Header title="Providers & creators" subtitle="Admin review, payout, readiness, and availability" />}>
      {queueFirstCompositionEnabled ? null : auditLogShortcut}
      <Input label="Search" placeholder="Name, phone or city" value={q} onChangeText={setQ} />
      <SegmentedControl
        options={[{ value: 'all', label: 'All' }, { value: 'creators', label: 'Creators' }, { value: 'pending', label: 'Review' }, { value: 'suspended', label: 'Suspended' }]}
        value={filter}
        onChange={setFilter}
      />
      {error && rows === null ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {rows === null && !error ? <Skeleton height={400} radius={t.radii.lg} /> : null}
      {rows !== null && error ? <Text variant="caption" color="muted">Showing the latest successfully loaded list. Refresh failed: {error}</Text> : null}
      {rows?.length ? rows.map((provider) => {
        const actions = providerReviewActions(provider);
        const saving = savingIds.has(provider.id);
        return (
          <Card key={provider.id} gap={t.spacing.md}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <View style={{ flex: 1, gap: 3 }}>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  <Text variant="calloutStrong" style={{ flexShrink: 1 }}>{provider.full_name || 'Unnamed provider'}</Text>
                  {provider.is_creator ? <Badge label="Creator" tone="info" /> : null}
                </View>
                <Text variant="caption" color="muted">{formatPhone(provider.phone)} · {provider.city || 'No city'}</Text>
                <Text variant="caption" color="muted">{provider.categories.join(', ') || 'No active services'}</Text>
                <Text variant="caption" color="muted">
                  Payout: {provider.has_payout_account ? `account set up · verification ${provider.kyc_status.replaceAll('_', ' ')}` : 'account not set up'}
                </Text>
                <Text variant="caption" color="muted">
                  Go-live readiness: {provider.go_live?.state.replaceAll('_', ' ') ?? 'not available'}
                  {provider.go_live?.reasons.length ? ` · ${provider.go_live.reasons.map((item) => item.detail?.trim() || item.code.replaceAll('_', ' ')).join('; ')}` : ''}
                </Text>
                <Text variant="caption" color="muted">
                  Availability: admin suspension {provider.suspended ? 'on' : 'off'} · provider pause {provider.paused ? 'on' : 'off'} · online preference {provider.is_online ? 'on' : 'off'}
                </Text>
              </View>
              <Badge
                label={`Admin review: ${provider.admin_review_status.replaceAll('_', ' ')}`}
                tone={STATUS_TONE[provider.admin_review_status] ?? 'neutral'}
              />
            </View>
            {provider.review_note?.trim() ? (
              <Text variant="footnote" color="muted">Stored review note: {provider.review_note}</Text>
            ) : null}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="footnote" color="muted">★ {provider.rating_avg || 'New'} · {provider.jobs_completed} jobs</Text>
              <Text variant="footnote" color="muted">{provider.is_online ? 'Online preference on' : 'Online preference off'}</Text>
            </View>
            {provider.submitted_at ? (
              <Input
                label="Reason (required for Reject or Ask for changes)"
                value={reasons[provider.id] ?? ''}
                onChangeText={(value) => setReasons((current) => ({ ...current, [provider.id]: value }))}
                maxLength={500}
              />
            ) : null}
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {actions.map((action) => (
                <Button
                  key={action}
                  title={reviewLabel(action)}
                  size="sm"
                  variant={action === 'approve' ? 'primary' : 'outline'}
                  loading={saving}
                  disabled={saving}
                  onPress={() => void run(provider, action)}
                />
              ))}
              <Button
                title={provider.suspended ? 'Restore' : 'Suspend'}
                size="sm"
                variant={provider.suspended ? 'outline' : 'destructiveGhost'}
                loading={saving}
                disabled={saving}
                onPress={() => void run(provider, provider.suspended ? 'restore' : 'suspend')}
              />
            </View>
          </Card>
        );
      }) : rows?.length === 0 ? (
        <EmptyState title="No providers found" message="No providers match this search and filter." />
      ) : null}
      {queueFirstCompositionEnabled ? auditLogShortcut : null}
    </Screen>
  );
}
