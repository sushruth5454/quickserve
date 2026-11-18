import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Header, InlineAlert, Input, Screen, Skeleton, Text, useToast } from '../src/components/ui';
import { useAppFeatureFlags } from '../src/lib/featureFlags';
import { useAuth } from '../src/lib/auth';
import {
  addBusinessMember,
  listBusinessMembers,
  removeBusinessMember,
  type BusinessMember,
  type MerchantRole,
} from '../src/features/merchantStaff/api';
import { useTheme } from '../src/theme';

export default function MerchantStaffScreen() {
  const t = useTheme();
  const toast = useToast();
  const { userId } = useAuth();
  const flags = useAppFeatureFlags();
  const enabled = flags.isOn('merchant_staff');
  const [members, setMembers] = useState<BusinessMember[]>([]);
  const [memberId, setMemberId] = useState('');
  const [role, setRole] = useState<Exclude<MerchantRole, 'owner'>>('staff');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!enabled || !userId) return;
    setLoading(true);
    try {
      setMembers(await listBusinessMembers(userId));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [enabled, userId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const add = async () => {
    if (!userId || !memberId.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await addBusinessMember(userId, memberId.trim(), role);
      setMemberId('');
      await load();
      toast({ message: 'Staff access added', tone: 'success' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (member: BusinessMember) => {
    if (!userId) return;
    setBusy(true);
    setError(null);
    try {
      await removeBusinessMember(userId, member.member_id);
      await load();
      toast({ message: 'Staff access removed', tone: 'success' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!enabled) {
    return (
      <Screen header={<Header title="Business staff" onBack={() => router.back()} />}>
        <InlineAlert message="Staff accounts are turned off right now." />
      </Screen>
    );
  }

  return (
    <Screen header={<Header title="Business staff" subtitle="Manage access for existing QuickServe users" onBack={() => router.back()} />} gap={t.spacing.md}>
      <InlineAlert message={error} />
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
          value={memberId}
          onChangeText={setMemberId}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={36}
          placeholder="User UUID"
        />
        <ViewRole role={role} onChange={setRole} />
        <Button title="Add staff access" onPress={() => void add()} loading={busy} disabled={busy || !memberId.trim()} />
      </Card>
      <Text variant="title3">Current staff</Text>
      {loading ? <Skeleton height={76} radius={t.radii.lg} /> : members.length ? members.map((member) => (
        <Card key={member.member_id} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Text variant="calloutStrong">{member.full_name || 'QuickServe user'}</Text>
            <Text variant="caption" color="muted">{member.role} · {member.active ? 'Active' : 'Inactive'} · {member.member_id}</Text>
          </View>
          {member.active ? <Button title="Remove" size="sm" variant="ghost" loading={busy} onPress={() => void remove(member)} /> : null}
        </Card>
      )) : <Text variant="footnote" color="muted">No staff members yet.</Text>}
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
