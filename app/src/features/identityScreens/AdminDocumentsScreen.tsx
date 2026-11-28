import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { Button, Card, EmptyState, ErrorState, Header, InlineAlert, Input, Screen, Skeleton, Text, useConfirm, useToast } from '../../components/ui';
import {
  createProviderDocumentSignedUrl,
  listDocumentQueue,
  listDocumentTypes,
  reviewDocument,
  type AdminDocumentQueueItem,
  type AdminDocumentType,
} from '../../lib/adminApi';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import { useTheme } from '../../theme';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Document review could not be completed.';
}

function documentScopeLabel(document: AdminDocumentQueueItem, contextualQueueEnabled: boolean): string {
  if (document.category_id) return `Category: ${document.category_name || 'Category unavailable'}`;
  return contextualQueueEnabled ? 'General credential' : 'General (all categories)';
}

export default function AdminDocumentsScreen() {
  const t = useTheme();
  const flags = useAppFeatureFlags();
  const contextualQueueEnabled = flags.isOn('oorva_admin_ops_ux');
  const confirm = useConfirm();
  const toast = useToast();
  const [documents, setDocuments] = useState<AdminDocumentQueueItem[] | null>(null);
  const [documentTypes, setDocumentTypes] = useState<AdminDocumentType[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [expiryDates, setExpiryDates] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyKeys, setBusyKeys] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const requestSequence = useRef(0);
  const reviewLocks = useRef(new Set<string>());
  const previewLocks = useRef(new Set<string>());

  const typeByCode = useMemo(
    () => new Map(documentTypes.map((type) => [type.code, type])),
    [documentTypes],
  );

  const setBusy = (key: string, busy: boolean) => {
    setBusyKeys((current) => {
      const next = new Set(current);
      if (busy) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const load = useCallback(async () => {
    const request = ++requestSequence.current;
    setError(null);
    setLoading(true);
    try {
      const [queue, types] = await Promise.all([listDocumentQueue(), listDocumentTypes()]);
      if (request !== requestSequence.current) return null;
      setDocuments(queue);
      setDocumentTypes(types);
      return null;
    } catch (e) {
      if (request !== requestSequence.current) return null;
      const message = errorMessage(e);
      setError(message);
      return message;
    } finally {
      if (request === requestSequence.current) setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const openDocument = async (document: AdminDocumentQueueItem) => {
    const key = `${document.document_id}:view`;
    if (previewLocks.current.has(document.document_id)) return;
    previewLocks.current.add(document.document_id);
    setBusy(key, true);
    try {
      const url = await createProviderDocumentSignedUrl(document.file_path);
      await Linking.openURL(url);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      previewLocks.current.delete(document.document_id);
      setBusy(key, false);
    }
  };

  const review = async (document: AdminDocumentQueueItem, approve: boolean) => {
    const id = document.document_id;
    if (reviewLocks.current.has(id)) return;
    const reason = reasons[id] ?? '';
    const expiry = expiryDates[id]?.trim() || document.expires_on || '';
    const type = typeByCode.get(document.doc_type);
    if (!approve && reason.trim().length < 5) {
      setError('Enter a reason of at least 5 characters to reject this document.');
      return;
    }
    if (approve && type?.has_expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
      setError('Enter the expiry date in YYYY-MM-DD format.');
      return;
    }

    reviewLocks.current.add(id);
    const busyKey = `${id}:review`;
    setBusy(busyKey, true);
    try {
      const categoryScope = documentScopeLabel(document, contextualQueueEnabled);
      const confirmed = await confirm({
        title: `${approve ? 'Approve' : 'Reject'} ${type?.label ?? document.doc_type.replaceAll('_', ' ')}?`,
        message: `${categoryScope} · ${document.provider_name || 'Provider'} · submitted ${new Date(document.created_at).toLocaleString('en-IN')}. ${approve ? 'This records the document review only.' : 'The provider will receive this reason.'}`,
        confirmLabel: approve ? 'Approve' : 'Reject',
        destructive: !approve,
      });
      if (!confirmed) return;

      await reviewDocument(
        id,
        approve,
        approve ? null : reason.trim(),
        approve ? expiry || null : null,
      );
      setReasons((current) => ({ ...current, [id]: '' }));
      setExpiryDates((current) => ({ ...current, [id]: '' }));
      const refreshError = await load();
      if (refreshError) {
        setError(`Review saved, but the pending queue could not be refreshed: ${refreshError}`);
      }
      toast({ message: approve ? 'Document approved' : 'Document rejected', tone: 'success' });
    } catch (e) {
      const actionError = errorMessage(e);
      const refreshError = await load();
      setError(refreshError ? `${actionError} Queue refresh failed: ${refreshError}` : actionError);
    } finally {
      reviewLocks.current.delete(id);
      setBusy(busyKey, false);
    }
  };

  return (
    <Screen
      header={<Header title="Provider documents" subtitle="Review submitted trust documents" />}
      gap={t.spacing.md}
      refreshing={loading}
      onRefresh={() => void load()}
    >
      {documents === null && error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {documents === null && !error ? <Skeleton height={280} radius={t.radii.lg} /> : null}
      {documents !== null ? <InlineAlert message={error} /> : null}
      {contextualQueueEnabled ? (
        <Text variant="caption" color="muted">Pending review queue · one credential per action</Text>
      ) : null}
      {documents?.length ? documents.map((document) => {
        const type = typeByCode.get(document.doc_type);
        const typeLabel = type?.label ?? document.doc_type.replaceAll('_', ' ');
        const created = new Date(document.created_at).toLocaleString('en-IN');
        const viewBusy = busyKeys.has(`${document.document_id}:view`);
        const reviewBusy = busyKeys.has(`${document.document_id}:review`);
        const scope = documentScopeLabel(document, contextualQueueEnabled);
        return (
          <Card key={document.document_id} gap={t.spacing.md}>
            {contextualQueueEnabled ? (
              <View style={{ gap: t.spacing.xs }}>
                <Text variant="calloutStrong">{document.provider_name || 'Provider'}</Text>
                <Text variant="caption" color="muted">{scope}</Text>
                <Text variant="body">Credential type: {typeLabel}</Text>
                <Text variant="caption" color="muted">Submitted {created}</Text>
                {document.expires_on ? (
                  <Text variant="caption" color="muted">Current expiry: {document.expires_on}</Text>
                ) : null}
              </View>
            ) : (
              <View style={{ gap: t.spacing.xs }}>
                <Text variant="calloutStrong">{document.provider_name || 'Provider'}</Text>
                <Text variant="body">{typeLabel}</Text>
                <Text variant="caption" color="muted">Scope: {scope}</Text>
                <Text variant="caption" color="muted">Submitted {created}</Text>
                {document.expires_on ? (
                  <Text variant="caption" color="muted">Current expiry: {document.expires_on}</Text>
                ) : null}
              </View>
            )}
            <Button
              title={contextualQueueEnabled ? 'View private document' : 'View document'}
              size="sm"
              variant="outline"
              loading={viewBusy}
              disabled={viewBusy}
              onPress={() => void openDocument(document)}
            />
            {type?.has_expiry ? (
              <Input
                label="Expiry date (YYYY-MM-DD)"
                placeholder="YYYY-MM-DD"
                value={expiryDates[document.document_id] ?? document.expires_on ?? ''}
                onChangeText={(value) => setExpiryDates((current) => ({ ...current, [document.document_id]: value }))}
                maxLength={10}
                autoCapitalize="none"
              />
            ) : null}
            <Input
              label="Reason (required to reject; at least 5 characters)"
              value={reasons[document.document_id] ?? ''}
              onChangeText={(value) => setReasons((current) => ({ ...current, [document.document_id]: value }))}
              maxLength={300}
              multiline
            />
            <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
              <Button
                title="Approve"
                size="sm"
                loading={reviewBusy}
                disabled={reviewBusy}
                onPress={() => void review(document, true)}
              />
              <Button
                title="Reject"
                size="sm"
                variant="outline"
                loading={reviewBusy}
                disabled={reviewBusy}
                onPress={() => void review(document, false)}
              />
            </View>
          </Card>
        );
      }) : documents?.length === 0 && !error ? (
        <EmptyState title="No provider documents waiting for review" message="New submissions will appear here." />
      ) : null}
    </Screen>
  );
}
