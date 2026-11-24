import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, ErrorState, Header, InlineAlert, Input, Screen, Skeleton, Text, useToast } from '../../components/ui';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import { useAuth } from '../../lib/auth';
import {
  addBusinessMember,
  listBusinessMembers,
  removeBusinessMember,
  type BusinessMember,
  type MerchantRole,
} from '../merchantStaff/api';
import { useTheme } from '../../theme';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Business staff could not be loaded.';
}

interface StaffReadState {
  userId: string | null;
  value: BusinessMember[] | null;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
}

function useMerchantStaffController() {
  const toast = useToast();
  const { userId, loading: authLoading } = useAuth();
  const enabled = useAppFeatureFlags().isOn('merchant_staff');
  const [memberId, setMemberId] = useState('');
  const [role, setRole] = useState<Exclude<MerchantRole, 'owner'>>('staff');
  const [read, setRead] = useState<StaffReadState>({
    userId: null,
    value: null,
    error: null,
    loading: false,
    refreshing: false,
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestSequence = useRef(0);

  const load = useCallback(async () => {
    if (!enabled || !userId) return;
    const request = ++requestSequence.current;
    setRead((current) => {
      const sameUser = current.userId === userId;
      const value = sameUser ? current.value : null;
      return {
        userId,
        value,
        error: sameUser ? current.error : null,
        loading: value === null,
        refreshing: value !== null,
      };
    });
    try {
      const value = await listBusinessMembers(userId);
      if (request !== requestSequence.current) return;
      setRead({ userId, value, error: null, loading: false, refreshing: false });
    } catch (error) {
      if (request !== requestSequence.current) return;
      setRead((current) => ({
        userId,
        value: current.userId === userId ? current.value : null,
        error: errorMessage(error),
        loading: false,
        refreshing: false,
      }));
    }
  }, [enabled, userId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const currentRead = read.userId === userId ? read : {
    userId,
    value: null,
    error: null,
    loading: false,
    refreshing: false,
  };
  const canManage = enabled && !!userId && currentRead.value !== null && !currentRead.error;

  const add = async () => {
    if (!canManage || !memberId.trim() || busy || !userId) return;
    setBusy(true);
    setActionError(null);
    try {
      await addBusinessMember(userId, memberId.trim(), role);
      setMemberId('');
      await load();
      toast({ message: 'Staff access added', tone: 'success' });
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (member: BusinessMember) => {
    if (!canManage || !userId || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await removeBusinessMember(userId, member.member_id);
      await load();
      toast({ message: 'Staff access removed', tone: 'success' });
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return {
    actionError,
    add,
    authLoading,
    busy,
    canManage,
    enabled,
    load,
    memberId,
    members: currentRead.value,
    readError: currentRead.error,
    refreshing: currentRead.refreshing,
    remove,
    role,
    setMemberId,
    setRole,
    userId,
  };
}

export default function MerchantStaffScreen() {
  const t = useTheme();
  const state = useMerchantStaffController();

  if (!state.enabled) {
    return (
      <Screen header={<Header title="Business staff" onBack={() => router.back()} />}>
        <InlineAlert message="Staff accounts are turned off right now." />
      </Screen>
    );
  }

  if (!state.userId && !state.authLoading) {
    return (
      <Screen header={<Header title="Business staff" onBack={() => router.back()} />}>
        <ErrorState message="Sign in to manage business staff." />
      </Screen>
    );
  }

  if (state.members === null && state.readError) {
    return (
      <Screen header={<Header title="Business staff" onBack={() => router.back()} />}>
        <ErrorState message={state.readError} onRetry={() => void state.load()} />
      </Screen>
    );
  }

  return (
    <Screen header={<Header title="Business staff" subtitle="Manage access for existing QuickServe users" onBack={() => router.back()} />} gap={t.spacing.md}>
      {state.actionError ? <InlineAlert message={state.actionError} /> : null}
      {state.members !== null && state.refreshing ? <Text variant="caption" color="muted">Refreshing staff access…</Text> : null}
      {state.members !== null && state.readError ? (
        <InlineAlert
          tone="warning"
          title="Showing the last successful staff list"
          message={state.readError}
          actionLabel="Retry"
          onAction={() => void state.load()}
        />
      ) : null}
      {state.members === null ? (
        <Skeleton height={76} radius={t.radii.lg} />
      ) : (
        <>
          {state.canManage ? (
            <Card gap={t.spacing.md}>
              <Text variant="title3">Add an existing user</Text>
              <Text variant="footnote" color="muted">
                Enter their QuickServe user ID. This does not send an email, text, or invitation link.
              </Text>
              <Text variant="caption" color="muted">
                After access is added, staff can open the Business work screen at /merchant-work.
              </Text>
              <Input
                label="QuickServe user ID"
                value={state.memberId}
                onChangeText={state.setMemberId}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={36}
                placeholder="User UUID"
              />
              <ViewRole role={state.role} onChange={state.setRole} />
              <Button title="Add staff access" onPress={() => void state.add()} loading={state.busy} disabled={state.busy || !state.memberId.trim()} />
            </Card>
          ) : null}
          <Text variant="title3">Current staff</Text>
          {state.members.length ? state.members.map((member) => (
            <Card key={member.member_id} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text variant="calloutStrong">{member.full_name || 'QuickServe user'}</Text>
                <Text variant="caption" color="muted">{member.role} · {member.active ? 'Active' : 'Inactive'} · {member.member_id}</Text>
              </View>
              {state.canManage && member.active ? (
                <Button title="Remove" size="sm" variant="ghost" loading={state.busy} onPress={() => void state.remove(member)} />
              ) : null}
            </Card>
          )) : state.readError
            ? null
            : <Text variant="footnote" color="muted">No staff members yet.</Text>}
        </>
      )}
    </Screen>
  );
}

function ViewRole({ role, onChange }: { role: Exclude<MerchantRole, 'owner'>; onChange: (value: Exclude<MerchantRole, 'owner'>) => void }) {
  const t = useTheme();
  return (
    <Card gap={t.spacing.sm} variant="outlined">
      <Text variant="captionStrong">Role</Text>
      <Button title="Staff · view jobs, RFQs and chat" variant={role === 'staff' ? 'secondary' : 'outline'} onPress={() => onChange('staff')} />
      <Button title="Manager · staff access plus quotes" variant={role === 'manager' ? 'secondary' : 'outline'} onPress={() => onChange('manager')} />
      <Text variant="caption" color="muted">
        Managers cannot manage members, payouts, prices, or verification.
      </Text>
    </Card>
  );
}
