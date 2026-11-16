import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Badge, BottomSheet, Button, Card, Chip, InlineAlert, Input, ListItem, Screen, Text, useConfirm, useToast, type Tone } from '../../components/ui';
import { onboardingApi, type DocStatus, type ProviderDocument, type ProviderLink, type ProviderLinkKind } from '../../lib/onboarding';
import { LIMITS } from '../../lib/onboarding/validation';
import { useTheme } from '../../theme';
import { pickDocument, pickPhoto } from './media';
import { FieldLabel, Intro, SectionFooter, istToday, type SectionProps } from './parts';

type Need = 'required' | 'recommended' | 'optional';

const STATUS: Record<DocStatus, { label: string; tone: Tone }> = {
  pending: { label: 'In review', tone: 'warning' },
  approved: { label: 'Live', tone: 'success' },
  rejected: { label: 'Not accepted', tone: 'danger' },
  expired: { label: 'Expired', tone: 'danger' },
  superseded: { label: 'Replaced', tone: 'neutral' },
};

/** Which documents to ask for, from the categories the provider offers (categories.requires_docs / recommended_docs). */
export function docNeeds(data: SectionProps['data']): { code: string; need: Need; forCategories: string[] }[] {
  const active = data.services.filter((s) => s.active);
  const map = new Map<string, { need: Need; forCategories: string[] }>();
  for (const s of active) {
    const c = data.categories.find((x) => x.id === s.category_id);
    if (!c) continue;
    for (const [codes, need] of [
      [c.requires_docs ?? [], 'required'],
      [c.recommended_docs ?? [], 'recommended'],
    ] as const) {
      for (const code of codes) {
        const cur = map.get(code);
        const rank = (n: Need) => (n === 'required' ? 0 : n === 'recommended' ? 1 : 2);
        map.set(code, {
          need: cur && rank(cur.need) < rank(need) ? cur.need : need,
          forCategories: [...(cur?.forCategories ?? []), c.name],
        });
      }
    }
  }
  for (const d of data.docTypes) if (!map.has(d.code)) map.set(d.code, { need: 'optional', forCategories: [] });
  const order = (n: Need) => (n === 'required' ? 0 : n === 'recommended' ? 1 : 2);
  return [...map.entries()]
    .map(([code, v]) => ({ code, ...v }))
    .sort((a, b) => order(a.need) - order(b.need) || (data.docTypes.find((d) => d.code === a.code)?.sort_order ?? 99) - (data.docTypes.find((d) => d.code === b.code)?.sort_order ?? 99));
}

function latestDoc(docs: ProviderDocument[], code: string): ProviderDocument | undefined {
  return docs.filter((d) => d.doc_type === code && d.status !== 'superseded').sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

export function PortfolioSection({ data, reload, header, mode, onDone, onBack }: SectionProps) {
  const t = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [photoSheet, setPhotoSheet] = useState(false);
  const [caption, setCaption] = useState('');
  const [docSheet, setDocSheet] = useState<string | null>(null);
  const [expiry, setExpiry] = useState('');
  const [showOptional, setShowOptional] = useState(false);
  const [links, setLinks] = useState<ProviderLink[]>([]);
  const [linkKind, setLinkKind] = useState<ProviderLinkKind>('website');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkHandle, setLinkHandle] = useState('');
  const portfolio = data.state.portfolio;
  const needs = useMemo(() => docNeeds(data), [data]);
  const missingRequired = needs.filter((n) => n.need === 'required' && !latestDoc(data.state.documents, n.code));
  const docType = data.docTypes.find((d) => d.code === docSheet);

  useEffect(() => {
    if (!data.state.provider) return;
    void onboardingApi.listProviderLinks().then(setLinks).catch((e: Error) => setError(e.message));
  }, [data.state.provider?.id]);

  const saveLink = async () => {
    let parsed: URL;
    try {
      parsed = new URL(linkUrl.trim());
      if (parsed.protocol !== 'https:') throw new Error();
    } catch {
      return setError('Use a full https:// link, for example https://instagram.com/yourname.');
    }
    setBusy('link');
    setError(null);
    try {
      // Handles are display labels; the server rejects '@' (it reads as a contact handle), so drop a leading one.
      await onboardingApi.saveProviderLink({ kind: linkKind, url: parsed.toString(), handle: linkHandle.trim().replace(/^@+/, '') || null });
      setLinks(await onboardingApi.listProviderLinks());
      setLinkUrl('');
      setLinkHandle('');
      toast({ message: 'Link added to your public profile', tone: 'success' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // Pick while the sheet is still open (see BasicsSection.choose), then close it before uploading.
  const addPhoto = async (source: 'camera' | 'library') => {
    setBusy('photo');
    setError(null);
    try {
      let f;
      try {
        f = await pickPhoto('portfolio', source);
      } finally {
        setPhotoSheet(false);
      }
      if (!f) return;
      await onboardingApi.addPortfolioPhoto(f.uri, f.mimeType, caption.trim());
      setCaption('');
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const uploadDoc = async () => {
    if (!docSheet) return;
    let expiresOn: string | null = null;
    if (docType?.has_expiry) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry.trim()) || Number.isNaN(Date.parse(expiry.trim()))) return setError('Enter the expiry date as YYYY-MM-DD.');
      if (expiry.trim() < istToday()) return setError('This document has already expired.');
      expiresOn = expiry.trim();
    }
    setBusy(docSheet);
    setError(null);
    try {
      const f = await pickDocument();
      if (!f) return;
      await onboardingApi.uploadDocument(docSheet, f.uri, f.mimeType, null, expiresOn);
      setDocSheet(null);
      setExpiry('');
      await reload();
      toast({ message: 'Document uploaded for review', tone: 'success' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const next = async () => {
    if (mode === 'wizard') await onboardingApi.setStep(5).catch(() => undefined);
    onDone();
  };

  const visibleNeeds = showOptional ? needs : needs.filter((n) => n.need !== 'optional' || latestDoc(data.state.documents, n.code));

  return (
    <Screen
      header={header}
      gap={t.spacing.xl}
      footer={
        <SectionFooter
          primary={mode === 'wizard' ? (portfolio.length ? 'Continue' : 'Skip for now') : 'Done'}
          onPrimary={() => void next()}
          onBack={onBack}
        />
      }
    >
      <Intro title="Your work, links & credentials" subtitle="Your Instagram, YouTube or website and photos of real work help customers trust you. Documents are private — only our review team sees them." />
      <InlineAlert message={error} />

      <View style={{ gap: t.spacing.md }}>
        <FieldLabel hint="Portfolio links only. Don't include phone numbers, WhatsApp, email or payment handles.">
          Instagram, YouTube & website links
        </FieldLabel>
        <Card gap={t.spacing.md}>
          {links.map((link) => (
            <ListItem
              key={link.id}
              icon="link-outline"
              title={link.handle || LINK_LABEL[link.kind]}
              subtitle={`${link.url} · ${link.status === 'approved' ? 'Live on your profile' : link.status === 'rejected' ? `Not approved: ${link.review_reason ?? 'Review needed'}` : 'Live on your profile'}`}
              right={
                <Button
                  title="Remove"
                  size="sm"
                  variant="ghost"
                  onPress={async () => {
                    await onboardingApi.deleteProviderLink(link.id).catch((e: Error) => setError(e.message));
                    setLinks(await onboardingApi.listProviderLinks());
                  }}
                />
              }
            />
          ))}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
            {(['instagram', 'youtube', 'facebook', 'website', 'behance', 'google_business', 'other'] as ProviderLinkKind[]).map((kind) => (
              <Chip key={kind} label={LINK_LABEL[kind]} selected={linkKind === kind} onPress={() => setLinkKind(kind)} />
            ))}
          </View>
          <Input label="Public profile or website URL" value={linkUrl} onChangeText={setLinkUrl} placeholder={LINK_PLACEHOLDER[linkKind]} autoCapitalize="none" keyboardType="url" />
          <Input label="Display name (optional)" value={linkHandle} onChangeText={setLinkHandle} placeholder="yourprofile" autoCapitalize="none" />
          <Button title="Add link" leftIcon="add" variant="outline" onPress={() => void saveLink()} loading={busy === 'link'} disabled={!linkUrl.trim()} />
        </Card>
      </View>

      <View style={{ gap: t.spacing.md }}>
        <FieldLabel hint={`Up to ${LIMITS.portfolioMax} photos of jobs you did. No customer faces, house numbers or personal details.`}>
          {`Work photos (${portfolio.length}/${LIMITS.portfolioMax})`}
        </FieldLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
          {portfolio.map((ph) => (
            <PortfolioTile
              key={ph.id}
              uri={onboardingApi.publicUrl('portfolio', ph.file_path)}
              caption={ph.caption}
              onSaveCaption={(c) => onboardingApi.updatePortfolioCaption(ph.id, c).then(reload).catch((e: Error) => setError(e.message))}
              onDelete={async () => {
                const ok = await confirm({ title: 'Delete this photo?', confirmLabel: 'Delete', destructive: true });
                if (!ok) return;
                await onboardingApi.deletePortfolioPhoto(ph.id).catch((e: Error) => setError(e.message));
                await reload();
              }}
            />
          ))}
        </View>
        {portfolio.length < LIMITS.portfolioMax ? (
          <View style={{ gap: t.spacing.sm }}>
            <Input placeholder="Caption for the next photo (optional), e.g. Split AC installation" value={caption} onChangeText={setCaption} maxLength={120} />
            <Button title="Add work photo" leftIcon="image-outline" variant="outline" onPress={() => setPhotoSheet(true)} loading={busy === 'photo'} />
          </View>
        ) : null}
      </View>

      <View style={{ gap: t.spacing.md }}>
        <FieldLabel hint="Aadhaar is never uploaded here — identity is verified by our payment partner with your PAN and bank account.">Documents</FieldLabel>
        {missingRequired.length ? <InlineAlert tone="warning" message={`Required before customers can book you: ${missingRequired.map((n) => data.docTypes.find((d) => d.code === n.code)?.label ?? n.code).join(', ')}.`} /> : null}
        <Card gap={0} padding={0}>
          {visibleNeeds.map((n) => {
            const type = data.docTypes.find((d) => d.code === n.code);
            const doc = latestDoc(data.state.documents, n.code);
            const st = doc ? STATUS[doc.status] : null;
            const sub = [
              n.need === 'required' ? `Required for ${n.forCategories.join(', ')}` : n.need === 'recommended' ? `Recommended for ${n.forCategories.join(', ')}` : 'Optional',
              doc?.status === 'rejected' && doc.reject_reason ? `Reason: ${doc.reject_reason}` : null,
              doc?.expires_on ? `Valid till ${doc.expires_on}` : null,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <ListItem
                key={n.code}
                icon={n.need === 'required' ? 'shield-checkmark-outline' : 'document-text-outline'}
                title={type?.label ?? n.code}
                subtitle={sub}
                right={
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    {st ? <Badge label={st.label} tone={st.tone} /> : null}
                    <Button
                      title={doc ? 'Replace' : 'Upload'}
                      size="sm"
                      variant={doc ? 'ghost' : 'outline'}
                      loading={busy === n.code}
                      onPress={() => {
                        setExpiry('');
                        setDocSheet(n.code);
                      }}
                    />
                  </View>
                }
              />
            );
          })}
        </Card>
        {!showOptional ? <Button title="Add another certificate" size="sm" variant="ghost" leftIcon="add" onPress={() => setShowOptional(true)} style={{ alignSelf: 'flex-start' }} /> : null}
      </View>

      <BottomSheet visible={photoSheet} onClose={() => setPhotoSheet(false)} title="Add work photo">
        <View style={{ marginHorizontal: -t.spacing.xl }}>
          <ListItem icon="camera-outline" title="Take a photo" onPress={() => void addPhoto('camera')} />
          <ListItem icon="images-outline" title="Choose from gallery" onPress={() => void addPhoto('library')} />
        </View>
      </BottomSheet>

      <BottomSheet visible={docSheet != null} onClose={() => setDocSheet(null)} title={docType?.label ?? 'Upload document'}>
        <View style={{ gap: t.spacing.md }}>
          <Text variant="callout" color="textSecondary">
            {docType?.description}
          </Text>
          <Text variant="footnote" color="muted">
            JPG, PNG or PDF, up to 10 MB. Make sure your name and the issue date are readable.
          </Text>
          {docType?.has_expiry ? <Input label="Valid till (YYYY-MM-DD)" placeholder="2027-03-31" value={expiry} onChangeText={setExpiry} keyboardType="numbers-and-punctuation" maxLength={10} /> : null}
          <Button title="Choose file" leftIcon="cloud-upload-outline" onPress={() => void uploadDoc()} loading={busy === docSheet} />
        </View>
      </BottomSheet>
    </Screen>
  );
}

function PortfolioTile({ uri, caption, onSaveCaption, onDelete }: { uri: string; caption: string; onSaveCaption: (c: string) => Promise<unknown>; onDelete: () => void }) {
  const t = useTheme();
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(caption);
  return (
    <View style={{ width: '48%', gap: 4 }}>
      <Image source={{ uri }} style={{ width: '100%', aspectRatio: 1, borderRadius: t.radii.md, backgroundColor: t.colors.surfaceAlt }} contentFit="cover" accessibilityLabel={caption || 'Work photo'} />
      {edit ? (
        <View style={{ gap: 4 }}>
          <Input value={text} onChangeText={setText} maxLength={120} accessibilityLabel="Caption" />
          <Button title="Save caption" size="sm" onPress={() => void onSaveCaption(text.trim()).then(() => setEdit(false))} />
        </View>
      ) : (
        <Text variant="footnote" color={caption ? 'textSecondary' : 'muted'} numberOfLines={2}>
          {caption || 'No caption'}
        </Text>
      )}
      <View style={{ flexDirection: 'row' }}>
        <Button title={edit ? 'Cancel' : 'Edit caption'} size="sm" variant="ghost" onPress={() => setEdit((e) => !e)} />
        <Button title="Delete" size="sm" variant="destructiveGhost" onPress={onDelete} />
      </View>
    </View>
  );
}

const LINK_LABEL: Record<ProviderLinkKind, string> = {
  instagram: 'Instagram',
  youtube: 'YouTube',
  facebook: 'Facebook',
  website: 'Website',
  behance: 'Behance',
  google_business: 'Google Business',
  other: 'Other',
};

const LINK_PLACEHOLDER: Record<ProviderLinkKind, string> = {
  instagram: 'https://instagram.com/yourprofile',
  youtube: 'https://youtube.com/@yourchannel',
  facebook: 'https://facebook.com/yourpage',
  website: 'https://yourwebsite.com',
  behance: 'https://behance.net/yourprofile',
  google_business: 'https://g.page/yourbusiness',
  other: 'https://',
};