import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Linking, View } from 'react-native';
import { Button, Card, ErrorState, Header, InlineAlert, Input, Screen, Skeleton, Text, useToast } from '../../src/components/ui';
import {
  createProviderDocumentSignedUrl,
  listDocumentQueue,
  listDocumentTypes,
  reviewDocument,
  type AdminDocumentQueueItem,
  type AdminDocumentType,
} from '../../src/lib/adminApi';
import { useTheme } from '../../src/theme';

export default function AdminDocumentsScreen() {
  const t = useTheme();
  const toast = useToast();
  const [documents, setDocuments] = useState<AdminDocumentQueueItem[] | null>(null);
  const [documentTypes, setDocumentTypes] = useState<AdminDocumentType[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [expiryDates, setExpiryDates] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const typeByCode = useMemo(
    () => new Map(documentTypes.map((type) => [type.code, type])),
    [documentTypes],
  );

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [queue, types] = await Promise.all([listDocumentQueue(), listDocumentTypes()]);
      setDocuments(queue);
      setDocumentTypes(types);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const openDocument = async (document: AdminDocumentQueueItem) => {
    setBusy(`${document.document_id}:view`);
    try {
      const url = await createProviderDocumentSignedUrl(document.file_path);
      await Linking.openURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const review = async (document: AdminDocumentQueueItem, approve: boolean) => {
    const reason = reasons[document.document_id] ?? '';
    const expiry = expiryDates[document.document_id]?.trim() || document.expires_on || '';
    const type = typeByCode.get(document.doc_type);
    if (!approve && reason.trim().length < 5) {
      setError('Enter a reason of at least 5 characters to reject this document.');
      return;
    }
    if (approve && type?.has_expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
      setError('Enter the expiry date in YYYY-MM-DD format.');
      return;
    }

    setBusy(document.document_id);
    setError(null);
    try {
      await reviewDocument(
        document.document_id,
        approve,
        approve ? null : reason.trim(),
        approve ? expiry || null : null,
      );
      setReasons((current) => ({ ...current, [document.document_id]: '' }));
      setExpiryDates((current) => ({ ...current, [document.document_id]: '' }));
      toast({ message: approve ? 'Document approved' : 'Document rejected', tone: 'success' });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
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
      {documents?.length ? documents.map((document) => {
        const type = typeByCode.get(document.doc_type);
        const created = new Date(document.created_at).toLocaleString('en-IN');
        return (
          <Card key={document.document_id} gap={t.spacing.md}>
            <View style={{ gap: t.spacing.xs }}>
              <Text variant="calloutStrong">{document.provider_name || 'Provider'}</Text>
              <Text variant="body">{type?.label ?? document.doc_type.replaceAll('_', ' ')}</Text>
              <Text variant="caption" color="muted">Submitted {created}</Text>
              {document.expires_on ? (
                <Text variant="caption" color="muted">Current expiry: {document.expires_on}</Text>
              ) : null}
            </View>
            <Button
              title="View document"
              size="sm"
              variant="outline"
              loading={busy === `${document.document_id}:view`}
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
                loading={busy === document.document_id}
                onPress={() => void review(document, true)}
              />
              <Button
                title="Reject"
                size="sm"
                variant="outline"
                loading={busy === document.document_id}
                onPress={() => void review(document, false)}
              />
            </View>
          </Card>
        );
      }) : documents?.length === 0 ? <Text variant="footnote" color="muted">No provider documents are waiting for review.</Text> : null}
    </Screen>
  );
}
