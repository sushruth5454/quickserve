import { useFocusEffect } from 'expo-router';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import {
  areDraftsEqual,
  brandingAssetIds,
  cloneBrandingConfig,
  cloneBrandingDraft,
  defaultBrandingDraft,
  draftFromConfig,
  isBrandingEditorEnabled,
  isPreviewUrlFresh,
  isUuid,
  parseBrandingSnapshot,
  parseBrandingVersionDetail,
  parseBrandingVersions,
  parseSignedAssetPreview,
  previewConfig,
  validateBrandingDraft,
  type BrandingDraft,
  type BrandingSnapshot,
  type BrandingVersion,
  type SignedAssetPreview,
} from './model';

export type BrandingAssetSlot = 'logoLight' | 'logoDark' | 'compactLight' | 'compactDark' | 'promotional';

type Freshness = 'loading' | 'live' | 'stale' | 'error';

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) return String(error.message);
  return String(error);
}

function errorCodeOf(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : null;
}

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args ?? {});
  if (error) {
    const result = new Error(error.message);
    Object.assign(result, { code: error.code });
    throw result;
  }
  return data as T;
}

function toUint8Array(base64: string): Uint8Array {
  const decoded = globalThis.atob(base64);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

function createVersionId(): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) throw new Error('Secure version IDs are unavailable on this device.');
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function reasonIsValid(reason: string): boolean {
  const length = Array.from(reason.trim()).length;
  return length >= 1 && length <= 500;
}

function makeErrorMessage(error: unknown, action: 'publish' | 'recover'): string {
  if (errorCodeOf(error) === '40001') {
    return action === 'publish'
      ? 'Another admin published first. Your draft is unchanged. Refresh status, review the new current version, then publish again.'
      : 'Another admin changed the published version first. Refresh status and review history before trying recovery again.';
  }
  return messageOf(error);
}

export function useBrandingController() {
  const localFeatures = useAppFeatureFlags();
  const [history, setHistory] = useState<BrandingVersion[]>([]);
  const [snapshot, setSnapshot] = useState<BrandingSnapshot | null>(null);
  const [draft, setDraft] = useState<BrandingDraft | null>(null);
  const [baseline, setBaseline] = useState<BrandingDraft | null>(null);
  const [draftVersionId, setDraftVersionId] = useState<string | null>(null);
  const [freshness, setFreshness] = useState<Freshness>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [publishReason, setPublishReason] = useState('');
  const [recoveryReason, setRecoveryReason] = useState('');
  const [writing, setWriting] = useState(false);
  const [uploadingSlot, setUploadingSlot] = useState<BrandingAssetSlot | null>(null);
  const [assetPreviews, setAssetPreviews] = useState<Record<string, SignedAssetPreview>>({});
  const [previewRefreshNonce, setPreviewRefreshNonce] = useState(0);
  const loadSequence = useRef(0);
  const writeInFlight = useRef(false);
  const draftRef = useRef<BrandingDraft | null>(null);
  const baselineRef = useRef<BrandingDraft | null>(null);
  const draftVersionIdRef = useRef<string | null>(null);
  const snapshotRef = useRef<BrandingSnapshot | null>(null);

  const dirty = useMemo(() => !areDraftsEqual(draft, baseline), [baseline, draft]);
  const effectiveFlags = snapshot?.flags ?? localFeatures;
  const editorEnabled = isBrandingEditorEnabled(effectiveFlags);
  const previewsAllowed = editorEnabled && freshness === 'live';
  const validation = useMemo(
    () => draft ? validateBrandingDraft(draft) : { config: null, errors: [] },
    [draft],
  );
  const previewAppearance = useMemo(() => draft ? previewConfig(draft) : null, [draft]);
  const assetIdsKey = useMemo(
    () => brandingAssetIds(previewAppearance).join('|'),
    [previewAppearance],
  );

  const replaceDraft = useCallback((next: BrandingDraft, nextBaseline: BrandingDraft, versionId: string | null) => {
    const nextDraft = cloneBrandingDraft(next);
    const nextSaved = cloneBrandingDraft(nextBaseline);
    draftRef.current = nextDraft;
    baselineRef.current = nextSaved;
    draftVersionIdRef.current = versionId;
    setDraft(nextDraft);
    setBaseline(nextSaved);
    setDraftVersionId(versionId);
  }, []);

  const refresh = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoadError(null);
    setNotice(null);
    try {
      const [versionRows, snapshotValue] = await Promise.all([
        rpc<unknown>('admin_list_branding_versions'),
        rpc<unknown>('get_app_branding_snapshot'),
      ]);
      const nextHistory = parseBrandingVersions(versionRows);
      const nextSnapshot = parseBrandingSnapshot(snapshotValue);
      let nextDraft: BrandingDraft | null = null;
      let nextVersionId: string | null = null;

      if (!draftRef.current || areDraftsEqual(draftRef.current, baselineRef.current)) {
        const latestDraft = nextHistory.find((version) => !version.published);
        if (latestDraft) {
          const detail = await rpc<unknown>('admin_get_branding_version', { p_version_id: latestDraft.id });
          nextDraft = draftFromConfig(parseBrandingVersionDetail(detail));
          nextVersionId = latestDraft.id;
        } else {
          nextDraft = draftFromConfig(nextSnapshot.config ?? defaultBrandingDraft().config);
        }
      }

      if (sequence !== loadSequence.current) return;
      setHistory(nextHistory);
      snapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
      if (nextDraft) replaceDraft(nextDraft, nextDraft, nextVersionId);
      setFreshness('live');
      setActionError(null);
    } catch (error) {
      if (sequence !== loadSequence.current) return;
      setLoadError(messageOf(error));
      setFreshness(snapshotRef.current ? 'stale' : 'error');
    }
  }, [replaceDraft]);

  useFocusEffect(useCallback(() => {
    void refresh();
  }, [refresh]));

  const updateDraft = useCallback((next: BrandingDraft) => {
    const nextDraft = cloneBrandingDraft(next);
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    setActionError(null);
    setNotice(null);
  }, []);

  const saveDraft = useCallback(async () => {
    const currentDraft = draftRef.current;
    if (!currentDraft || !editorEnabled || !dirty || writeInFlight.current) return;
    const checked = validateBrandingDraft(currentDraft);
    if (!checked.config) {
      setActionError(checked.errors.join(' '));
      return;
    }

    writeInFlight.current = true;
    setWriting(true);
    setActionError(null);
    setNotice(null);
    try {
      const versionId = createVersionId();
      const savedId = await rpc<unknown>('admin_save_branding_draft', {
        p_config: checked.config,
        p_version_id: versionId,
      });
      if (typeof savedId !== 'string' || savedId.toLowerCase() !== versionId) {
        throw new Error('The saved draft could not be verified. Refresh history before continuing.');
      }
      const savedDraft = cloneBrandingDraft(currentDraft);
      replaceDraft(savedDraft, savedDraft, savedId);
      await refresh();
      setNotice('Immutable draft saved. Publishing still requires a current generation and reason.');
    } catch (error) {
      setActionError(messageOf(error));
    } finally {
      writeInFlight.current = false;
      setWriting(false);
    }
  }, [dirty, editorEnabled, refresh, replaceDraft]);

  const publish = useCallback(async () => {
    const currentDraft = draftRef.current;
    const versionId = draftVersionIdRef.current;
    const currentSnapshot = snapshotRef.current;
    if (
      !currentDraft ||
      !versionId ||
      !currentSnapshot ||
      freshness !== 'live' ||
      !editorEnabled ||
      !areDraftsEqual(currentDraft, baselineRef.current) ||
      !reasonIsValid(publishReason) ||
      writeInFlight.current
    ) return;

    writeInFlight.current = true;
    setWriting(true);
    setActionError(null);
    setNotice(null);
    try {
      await rpc<unknown>('admin_publish_branding', {
        p_version_id: versionId,
        p_expected_generation: currentSnapshot.generation,
        p_reason: publishReason.trim(),
      });
      setPublishReason('');
      await refresh();
      setNotice('Published against the generation you reviewed.');
    } catch (error) {
      const message = makeErrorMessage(error, 'publish');
      setActionError(message);
      if (errorCodeOf(error) === '40001') setFreshness('stale');
    } finally {
      writeInFlight.current = false;
      setWriting(false);
    }
  }, [editorEnabled, freshness, publishReason, refresh]);

  const recover = useCallback(async (version: BrandingVersion) => {
    const currentSnapshot = snapshotRef.current;
    if (
      !version.published ||
      version.current ||
      !currentSnapshot ||
      freshness !== 'live' ||
      !reasonIsValid(recoveryReason) ||
      writeInFlight.current
    ) return;

    writeInFlight.current = true;
    setWriting(true);
    setActionError(null);
    setNotice(null);
    try {
      await rpc<unknown>('admin_rollback_branding', {
        p_version_id: version.id,
        p_expected_generation: currentSnapshot.generation,
        p_reason: recoveryReason.trim(),
      });
      setRecoveryReason('');
      await refresh();
      setNotice(`Recovered version ${version.versionNumber} against the reviewed generation.`);
    } catch (error) {
      const message = makeErrorMessage(error, 'recover');
      setActionError(message);
      if (errorCodeOf(error) === '40001') setFreshness('stale');
    } finally {
      writeInFlight.current = false;
      setWriting(false);
    }
  }, [freshness, recoveryReason, refresh]);

  const uploadAsset = useCallback(async (slot: BrandingAssetSlot) => {
    if (!editorEnabled || writeInFlight.current) return;
    writeInFlight.current = true;
    setUploadingSlot(slot);
    setActionError(null);
    setNotice(null);
    try {
      const selection = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
        base64: false,
      });
      if (selection.canceled) return;
      const source = selection.assets[0]?.uri;
      if (!source) throw new Error('No image was selected.');
      const converted = await ImageManipulator.manipulateAsync(source, [], {
        format: ImageManipulator.SaveFormat.PNG,
        base64: true,
      });
      if (!converted.base64) throw new Error('The selected image could not be converted to PNG.');
      const bytes = toUint8Array(converted.base64);
      const body = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(body).set(bytes);
      const { data, error } = await supabase.functions.invoke('branding-assets?action=upload', {
        body,
        headers: { 'Content-Type': 'image/png' },
      });
      if (error) throw new Error(error.message);
      const assetId = typeof data === 'object' && data !== null
        ? (data as Record<string, unknown>).assetId
        : null;
      if (!isUuid(assetId)) throw new Error('The uploaded image was not registered. Refresh history before continuing.');
      const current = draftRef.current;
      if (!current) return;
      const config = cloneBrandingConfig(current.config);
      if (slot === 'promotional') {
        if (config.assets.promotional.length >= 6) throw new Error('At most six promotional images are allowed.');
        config.assets.promotional = [...config.assets.promotional, assetId];
      } else {
        config.assets[slot] = assetId;
      }
      updateDraft({ ...current, config });
      setNotice('PNG uploaded and attached to the local draft. Save the draft to make it recoverable.');
    } catch (error) {
      setActionError(messageOf(error));
    } finally {
      writeInFlight.current = false;
      setUploadingSlot(null);
    }
  }, [editorEnabled, updateDraft]);

  const clearAsset = useCallback((slot: BrandingAssetSlot, index?: number) => {
    const current = draftRef.current;
    if (!current || writeInFlight.current) return;
    const config = cloneBrandingConfig(current.config);
    if (slot === 'promotional') {
      if (index === undefined) return;
      config.assets.promotional = config.assets.promotional.filter((_, itemIndex) => itemIndex !== index);
    } else {
      config.assets[slot] = null;
    }
    updateDraft({ ...current, config });
  }, [updateDraft]);

  const previewLookup = useMemo(() => {
    const lookup: Record<string, SignedAssetPreview> = {};
    for (const [assetId, preview] of Object.entries(assetPreviews)) {
      if (isPreviewUrlFresh(preview)) lookup[assetId] = preview;
    }
    return lookup;
  }, [assetPreviews]);

  useEffect(() => {
    const ids = assetIdsKey ? assetIdsKey.split('|') : [];
    if (!previewsAllowed || ids.length === 0) {
      setAssetPreviews({});
      return;
    }
    let active = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const issued: Record<string, SignedAssetPreview> = {};
    setAssetPreviews({});
    const projectUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

    void Promise.all(ids.map(async (assetId) => {
      try {
        const { data, error } = await supabase.functions.invoke('branding-assets?action=preview', {
          body: { assetId },
        });
        if (error) return;
        const preview = parseSignedAssetPreview(data, assetId, projectUrl);
        if (!preview) return;
        issued[assetId] = preview;
      } catch {
        return;
      }
    })).then(() => {
      if (!active) return;
      setAssetPreviews(issued);
      for (const preview of Object.values(issued)) {
        const delay = Math.max(0, Date.parse(preview.expiresAt) - Date.now() - 1_000);
        timers.push(setTimeout(() => {
          if (!active) return;
          setAssetPreviews((current) => {
            const next = { ...current };
            delete next[preview.assetId];
            return next;
          });
          setPreviewRefreshNonce((value) => value + 1);
        }, delay));
      }
    });

    return () => {
      active = false;
      for (const timer of timers) clearTimeout(timer);
    };
  }, [assetIdsKey, previewRefreshNonce, previewsAllowed]);

  const getAssetPreview = useCallback(
    (assetId: string) => {
      const preview = previewLookup[assetId.toLowerCase()] ?? null;
      return preview && isPreviewUrlFresh(preview) ? preview.url : null;
    },
    [previewLookup],
  );

  const freshnessLabel = freshness === 'live'
    ? 'Live'
    : freshness === 'stale'
      ? 'Stale · refresh before publish or recovery'
      : freshness === 'error'
        ? 'Unavailable'
        : 'Loading';
  const currentVersion = history.find((version) => version.current) ?? null;
  const canPublish = editorEnabled &&
    freshness === 'live' &&
    !dirty &&
    draftVersionId !== null &&
    reasonIsValid(publishReason) &&
    !writing &&
    uploadingSlot === null;

  return {
    history,
    snapshot,
    currentVersion,
    draft,
    dirty,
    draftVersionId,
    freshness,
    freshnessLabel,
    loadError,
    actionError,
    notice,
    editorEnabled,
    writing,
    uploadingSlot,
    validationErrors: validation.errors,
    previewAppearance,
    publishReason,
    recoveryReason,
    canPublish,
    getAssetPreview,
    refresh,
    updateDraft,
    saveDraft,
    publish,
    recover,
    uploadAsset,
    clearAsset,
    setPublishReason,
    setRecoveryReason,
  };
}
