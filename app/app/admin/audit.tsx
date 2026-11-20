import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, EmptyState, ErrorState, Header, Input, Screen, Skeleton, Text } from '../../src/components/ui';
import { listAudit, type AdminAuditEntry } from '../../src/lib/adminApi';
import { useTheme } from '../../src/theme';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function AdminAuditScreen() {
  const t = useTheme();
  const { target: routeTarget } = useLocalSearchParams<{ target?: string }>();
  const [targetInput, setTargetInput] = useState(routeTarget ?? '');
  const [target, setTarget] = useState(routeTarget ?? '');
  const [rows, setRows] = useState<AdminAuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const nextTarget = routeTarget ?? '';
    setTargetInput(nextTarget);
    setTarget(nextTarget);
  }, [routeTarget]);

  const load = useCallback(() => {
    setError(null);
    setRows(null);
    const normalized = target.trim();
    if (normalized && !UUID.test(normalized)) {
      setError('Enter a full target UUID or leave the filter blank.');
      return;
    }
    void listAudit(normalized || null, 100)
      .then(setRows)
      .catch((cause: Error) => setError(cause.message));
  }, [target]);
  useFocusEffect(load);

  const applyFilter = () => {
    const normalized = targetInput.trim();
    if (normalized && !UUID.test(normalized)) {
      setError('Enter a full target UUID or leave the filter blank.');
      return;
    }
    setTarget(normalized);
  };

  return (
    <Screen header={<Header title="Admin audit log" subtitle="Administrative actions and dispute outcomes" />}>
      <Card gap={t.spacing.md}>
        <Input
          label="Target ID (optional)"
          placeholder="UUID"
          value={targetInput}
          onChangeText={setTargetInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button title="Apply filter" variant="outline" onPress={applyFilter} />
      </Card>
      {error ? <ErrorState message={error} onRetry={load} /> : !rows ? <Skeleton height={420} radius={t.radii.lg} /> : null}
      {rows?.length === 0 ? <EmptyState compact title="No audit entries" message="Try a different target ID or clear the filter." /> : null}
      {rows?.map((row) => (
        <Card key={row.id} gap={t.spacing.sm}>
          <Text variant="calloutStrong">{row.action.replaceAll('_', ' ')}</Text>
          <Text variant="footnote">By {row.admin_name} · {new Date(row.created_at).toLocaleString('en-IN')}</Text>
          <Text variant="caption" color="muted">Target: {row.target_id ?? '—'}</Text>
          <Text variant="caption" color="muted">{JSON.stringify(row.details)}</Text>
        </Card>
      ))}
    </Screen>
  );
}
