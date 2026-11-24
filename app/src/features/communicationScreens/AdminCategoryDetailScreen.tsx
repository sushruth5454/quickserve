import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Switch, View } from 'react-native';
import { Button, Card, EmptyState, ErrorState, Header, InlineAlert, Input, Screen, Skeleton, Text, TextArea, useToast } from '../../components/ui';
import {
  adminUpsertCategory,
  listCategories,
  setCategoryCity,
  type AdminCategory,
  type AdminCategoryUpsert,
} from '../../lib/adminApi';
import { useAuth } from '../../lib/auth';
import { useFeature } from '../../lib/featureFlags';
import { useTheme } from '../../theme';
import {
  categoryMutationRegistry,
  categoryMutationWarningDelay,
  resolveCategorySessionUserId,
} from './AdminServicesScreen';

type CategoryDraft = {
  slug: string;
  name: string;
  icon: string;
  vertical: string;
  parent_id: string;
  archetype: string;
  pricing_units: string;
  recurrence_allowed: boolean;
  allowed_frequencies: string;
  recurring_discount_bp: string;
  cancellation_policy: string;
  requires_docs: string;
  restricted: boolean;
  intake_schema: string;
};

const ARCHETYPES = [
  { value: '', label: 'Group' },
  { value: 'inspect_quote', label: 'Inspect & quote' },
  { value: 'fixed', label: 'Fixed' },
  { value: 'time_based', label: 'Time-based' },
  { value: 'proposal', label: 'Proposal' },
  { value: 'remote', label: 'Remote' },
];

function emptyDraft(): CategoryDraft {
  return {
    slug: '',
    name: '',
    icon: '',
    vertical: '',
    parent_id: '',
    archetype: '',
    pricing_units: '',
    recurrence_allowed: false,
    allowed_frequencies: '',
    recurring_discount_bp: '',
    cancellation_policy: '',
    requires_docs: '',
    restricted: false,
    intake_schema: '{}',
  };
}

function toDraft(category: AdminCategory): CategoryDraft {
  return {
    slug: category.slug,
    name: category.name,
    icon: category.icon,
    vertical: category.vertical,
    parent_id: category.parent_id ?? '',
    archetype: category.archetype ?? '',
    pricing_units: category.pricing_units.join(', '),
    recurrence_allowed: category.recurrence_allowed,
    allowed_frequencies: category.allowed_frequencies.join(', '),
    recurring_discount_bp: category.recurring_discount_bp == null ? '' : String(category.recurring_discount_bp),
    cancellation_policy: category.cancellation_policy,
    requires_docs: category.requires_docs.join(', '),
    restricted: category.restricted,
    intake_schema: JSON.stringify(category.intake_schema, null, 2),
  };
}

function required(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  return trimmed;
}

function parseList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function wholeNumber(value: string, label: string, min: number, max: number): number {
  if (!/^\d+$/.test(value.trim())) throw new Error(`${label} must be a whole number.`);
  const parsed = Number(value);
  if (parsed < min || parsed > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return parsed;
}

function parseIntakeSchema(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Intake schema must be valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Intake schema must be a JSON object.');
  }
  const containsSensitiveField = (item: unknown): boolean => {
    if (Array.isArray(item)) return item.some(containsSensitiveField);
    if (!item || typeof item !== 'object') return false;
    return Object.entries(item).some(([key, child]) => /phone|address/i.test(key) || containsSensitiveField(child));
  };
  if (containsSensitiveField(parsed)) {
    throw new Error('Intake schema cannot collect phone numbers or addresses.');
  }
  return parsed as Record<string, unknown>;
}

function nextSortOrder(rows: AdminCategory[], parentId: string | null): number {
  const siblings = rows.filter((row) => row.parent_id === parentId);
  return siblings.length ? Math.max(...siblings.map((row) => row.sort_order)) + 10 : 0;
}

export function categorySortOrderForSave(
  category: AdminCategory | null,
  rows: AdminCategory[],
  parentId: string | null,
): number {
  const parentChanged = category != null && category.parent_id !== parentId;
  return category && !parentChanged ? category.sort_order : nextSortOrder(rows, parentId);
}

type DraftField = keyof CategoryDraft;
const DRAFT_FIELDS = Object.keys(emptyDraft()) as DraftField[];
type DraftVersions = Record<DraftField, number>;

function emptyDraftVersions(): DraftVersions {
  return Object.fromEntries(DRAFT_FIELDS.map((field) => [field, 0])) as DraftVersions;
}

type CategoryPendingOperation = 'save' | `city:${string}` | null;

interface CategoryEditorSession {
  initialized: boolean;
  draft: CategoryDraft | null;
  categoryId: string | null;
  cityDraft: string;
  draftVersions: DraftVersions;
  dirtyFields: Set<DraftField>;
  pendingSaveVersions: DraftVersions | null;
  pendingOperation: CategoryPendingOperation;
  pendingOperationToken: symbol | null;
  stale: boolean;
  readbackError: string | null;
  formError: string | null;
  cityError: string | null;
  activeConsumers: number;
  clearOnCompletion: boolean;
}

const categoryEditorSessions = new Map<string, CategoryEditorSession>();

function hasCategoryEditorWork(session: CategoryEditorSession): boolean {
  return session.dirtyFields.size > 0
    || session.cityDraft.length > 0
    || session.pendingSaveVersions !== null
    || session.pendingOperation !== null
    || session.stale
    || session.readbackError !== null
    || session.formError !== null
    || session.cityError !== null;
}

function createCategoryEditorSession(isNewRoute: boolean, id: string | undefined): CategoryEditorSession {
  return {
    initialized: false,
    draft: isNewRoute ? emptyDraft() : null,
    categoryId: isNewRoute ? null : id ?? null,
    cityDraft: '',
    draftVersions: emptyDraftVersions(),
    dirtyFields: new Set(),
    pendingSaveVersions: null,
    pendingOperation: null,
    pendingOperationToken: null,
    stale: false,
    readbackError: null,
    formError: null,
    cityError: null,
    activeConsumers: 0,
    clearOnCompletion: false,
  };
}

export function getCategoryEditorSession(
  key: string,
  isNewRoute: boolean,
  id: string | undefined,
): CategoryEditorSession {
  const existing = categoryEditorSessions.get(key);
  if (existing && !existing.clearOnCompletion
    && (existing.activeConsumers > 0 || hasCategoryEditorWork(existing))) return existing;
  const created = createCategoryEditorSession(isNewRoute, id);
  categoryEditorSessions.set(key, created);
  return created;
}

export function cleanupCategoryEditorSession(key: string, session: CategoryEditorSession): void {
  if (categoryEditorSessions.get(key) === session) {
    session.activeConsumers = Math.max(0, session.activeConsumers - 1);
    settleCategoryEditorSession(key, session);
  }
}

function settleCategoryEditorSession(key: string, session: CategoryEditorSession): void {
  if (categoryEditorSessions.get(key) === session
    && session.clearOnCompletion
    && session.activeConsumers === 0
    && session.pendingOperation === null) {
    categoryEditorSessions.delete(key);
  }
}

export function clearCategoryEditorSessionsForUser(userId: string | null): void {
  const prefix = `${userId ?? 'anonymous'}::`;
  for (const [key, session] of categoryEditorSessions) {
    if (!key.startsWith(prefix)) continue;
    if (session.pendingOperation !== null || session.activeConsumers > 0) {
      session.clearOnCompletion = true;
    } else {
      categoryEditorSessions.delete(key);
    }
  }
}

categoryMutationRegistry.registerUserCleanup(clearCategoryEditorSessionsForUser);

export function reconcileCategoryDraft(
  category: AdminCategory,
  current: CategoryDraft | null,
  preserveFields: ReadonlySet<DraftField>,
): { draft: CategoryDraft; dirtyFields: Set<DraftField> } {
  const canonical = toDraft(category);
  if (!current || preserveFields.size === 0) return { draft: canonical, dirtyFields: new Set() };
  const next = { ...canonical };
  for (const field of preserveFields) next[field] = current[field] as never;
  return { draft: next, dirtyFields: new Set(preserveFields) };
}

export function clearSubmittedCityDraft(current: string, submitted: string): string {
  return current.trim() === submitted ? '' : current;
}

type CategoryMutationResult<T> =
  | { status: 'busy' | 'stale' }
  | { status: 'write-failed'; error: Error }
  | { status: 'committed'; value: T; rows: AdminCategory[] }
  | { status: 'committed-readback-failed'; value: T; error: Error };

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function createCategoryMutationCoordinator(
  read: () => Promise<AdminCategory[]>,
  apply: (rows: AdminCategory[]) => void,
  onRefreshFailure: (error: Error) => void,
  userId: () => string | null = () => null,
) {
  const owner = Symbol('admin-category-editor-mutation');
  let generation = 0;
  let pending = false;

  return {
    owner,
    get pending() {
      return pending;
    },
    invalidate() {
      generation += 1;
    },
    async refresh(): Promise<
      | { status: 'refreshed'; rows: AdminCategory[] }
      | { status: 'busy' | 'stale' }
      | { status: 'failed'; error: Error }
    > {
      if (pending || categoryMutationRegistry.pending) return { status: 'busy' };
      const request = ++generation;
      try {
        const rows = await read();
        if (request !== generation) return { status: 'stale' };
        apply(rows);
        return { status: 'refreshed', rows };
      } catch (error) {
        const failure = asError(error);
        if (request === generation) onRefreshFailure(failure);
        return { status: 'failed', error: failure };
      }
    },
    async mutate<T>(
      write: () => Promise<T>,
      onReadbackFailure: (error: Error) => void,
      onCommitted?: (value: T) => void,
      label = 'Category change',
      onSettled?: () => void,
      onWriteFailure?: (error: Error) => void,
      onReadbackSuccess?: (value: T, rows: AdminCategory[]) => string | null,
      onStarted?: () => void,
    ): Promise<CategoryMutationResult<T>> {
      if (pending) return { status: 'busy' };
      pending = true;
      if (!categoryMutationRegistry.begin(owner, label, userId())) {
        pending = false;
        return { status: 'busy' };
      }
      const request = ++generation;
      let outcome: 'saved' | 'write-failed' | 'readback-failed' = 'write-failed';
      let outcomeMessage = `${label} ended before the write was confirmed.`;
      try {
        onStarted?.();
        let value: T;
        try {
          value = await write();
        } catch (error) {
          const failure = asError(error);
          onWriteFailure?.(failure);
          outcomeMessage = `${label} failed: ${failure.message}`;
          return { status: 'write-failed', error: failure };
        }
        onCommitted?.(value);
        try {
          const rows = await read();
          if (request !== generation) {
            outcome = 'readback-failed';
            outcomeMessage = `${label} was saved, but a newer category request superseded its readback.`;
            return { status: 'stale' };
          }
          apply(rows);
          const readbackIssue = onReadbackSuccess?.(value, rows) ?? null;
          if (readbackIssue) {
            outcome = 'readback-failed';
            outcomeMessage = readbackIssue;
          } else {
            outcome = 'saved';
            outcomeMessage = `${label} saved.`;
          }
          return { status: 'committed', value, rows };
        } catch (error) {
          const failure = asError(error);
          if (request === generation) onReadbackFailure(failure);
          outcome = 'readback-failed';
          outcomeMessage = `${label} was saved, but canonical category data could not be refreshed: ${failure.message}`;
          return { status: 'committed-readback-failed', value, error: failure };
        }
      } finally {
        pending = false;
        try {
          onSettled?.();
        } finally {
          categoryMutationRegistry.finish(owner, outcome, outcomeMessage);
        }
      }
    },
  };
}

export function useAdminCategoryDetailController(id: string | undefined) {
  const router = useRouter();
  const toast = useToast();
  const { userId } = useAuth();
  const previousUserIdRef = useRef(userId ?? categoryMutationRegistry.userId);
  const sessionUserId = resolveCategorySessionUserId(
    userId,
    categoryMutationRegistry.userId,
    categoryMutationRegistry.identityKnown,
  );
  const canEditCategories = useFeature('admin_category_editor');
  const isNewRoute = id === 'new';
  const sessionKey = `${sessionUserId ?? 'anonymous'}::${isNewRoute ? 'new' : `edit:${id ?? ''}`}`;
  const userIdRef = useRef(sessionUserId);
  userIdRef.current = sessionUserId;
  useEffect(() => {
    if (previousUserIdRef.current !== sessionUserId) {
      clearCategoryEditorSessionsForUser(previousUserIdRef.current);
      previousUserIdRef.current = sessionUserId;
    }
    categoryMutationRegistry.startAuthTracking();
    categoryMutationRegistry.setUser(sessionUserId);
  }, [sessionUserId]);
  const sessionBindingRef = useRef<{ key: string; value: CategoryEditorSession } | null>(null);
  if (!sessionBindingRef.current || sessionBindingRef.current.key !== sessionKey) {
    sessionBindingRef.current = {
      key: sessionKey,
      value: getCategoryEditorSession(sessionKey, isNewRoute, id),
    };
  }
  const session = sessionBindingRef.current.value;
  const [rows, setRows] = useState<AdminCategory[] | null>(null);
  const [, setSessionRevision] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [externalMutationPending, setExternalMutationPending] = useState(categoryMutationRegistry.pending);
  const [operationSlow, setOperationSlow] = useState(false);
  const draft = session.draft;
  const categoryId = session.categoryId;
  const readbackError = session.readbackError;
  const stale = session.stale;
  const formError = session.formError;
  const cityError = session.cityError;
  const cityDraft = session.cityDraft;
  const saving = session.pendingOperation === 'save';
  const savingCity = session.pendingOperation?.startsWith('city:') ? session.pendingOperation.slice(5) : null;
  const rowsRef = useRef<AdminCategory[] | null>(null);
  const {
    draftRef,
    categoryIdRef,
    dirtyFieldsRef,
    draftVersionsRef,
    pendingSaveVersionsRef,
    cityDraftRef,
  } = useMemo(() => ({
    draftRef: {
      get current() { return session.draft; },
      set current(value: CategoryDraft | null) { session.draft = value; },
    },
    categoryIdRef: {
      get current() { return session.categoryId; },
      set current(value: string | null) { session.categoryId = value; },
    },
    dirtyFieldsRef: {
      get current() { return session.dirtyFields; },
      set current(value: Set<DraftField>) { session.dirtyFields = value; },
    },
    draftVersionsRef: {
      get current() { return session.draftVersions; },
      set current(value: DraftVersions) { session.draftVersions = value; },
    },
    pendingSaveVersionsRef: {
      get current() { return session.pendingSaveVersions; },
      set current(value: DraftVersions | null) { session.pendingSaveVersions = value; },
    },
    cityDraftRef: {
      get current() { return session.cityDraft; },
      set current(value: string) { session.cityDraft = value; },
    },
  }), [session]);
  const initializedRouteRef = useRef(false);
  const loadedRouteIdRef = useRef(id);
  const loadedSessionKeyRef = useRef(sessionKey);
  const featureWasEnabledRef = useRef(false);
  const focusedRef = useRef(false);
  const seenMutationRevisionRef = useRef(categoryMutationRegistry.revision);
  const loadRef = useRef<(() => Promise<unknown>) | null>(null);

  const refreshSessionView = useCallback(() => setSessionRevision((revision) => revision + 1), []);
  const setDraft = useCallback((value: CategoryDraft | null) => {
    session.draft = value;
    refreshSessionView();
  }, [session]);
  const setCategoryId = useCallback((value: string | null) => {
    session.categoryId = value;
    refreshSessionView();
  }, [session]);
  const setReadbackError = useCallback((value: string | null) => {
    session.readbackError = value;
    refreshSessionView();
  }, [session]);
  const setStale = useCallback((value: boolean) => {
    session.stale = value;
    refreshSessionView();
  }, [session]);
  const setFormError = useCallback((value: string | null) => {
    session.formError = value;
    refreshSessionView();
  }, [session]);
  const setCityError = useCallback((value: string | null) => {
    session.cityError = value;
    refreshSessionView();
  }, [session]);
  const setCityDraft = useCallback((value: string | ((current: string) => string)) => {
    const next = typeof value === 'function' ? value(session.cityDraft) : value;
    session.cityDraft = next;
    refreshSessionView();
  }, [session]);
  const beginOperation = useCallback((operation: Exclude<CategoryPendingOperation, null>) => {
    const token = Symbol('category-editor-operation');
    session.pendingOperation = operation;
    session.pendingOperationToken = token;
    refreshSessionView();
    return token;
  }, [refreshSessionView, session]);
  const clearOperation = useCallback((token: symbol) => {
    if (session.pendingOperationToken !== token) return;
    session.pendingOperation = null;
    session.pendingOperationToken = null;
    refreshSessionView();
    settleCategoryEditorSession(sessionKey, session);
  }, [refreshSessionView, session, sessionKey]);

  useEffect(() => {
    session.activeConsumers += 1;
    return () => cleanupCategoryEditorSession(sessionKey, session);
  }, [session, sessionKey]);
  useEffect(() => {
    if (!saving && savingCity === null && !externalMutationPending) {
      setOperationSlow(false);
      return;
    }
    const startedAt = categoryMutationRegistry.lastOutcome?.pending
      ? categoryMutationRegistry.lastOutcome.startedAt
      : Date.now();
    const timer = setTimeout(
      () => setOperationSlow(true),
      categoryMutationWarningDelay(startedAt),
    );
    return () => clearTimeout(timer);
  }, [externalMutationPending, saving, savingCity]);

  const applyRows = useCallback((next: AdminCategory[]) => {
    rowsRef.current = next;
    setRows(next);
  }, []);
  const onRefreshFailure = useCallback((failure: Error) => {
    if (rowsRef.current === null) setLoadError(failure.message);
    else {
      const currentSession = sessionBindingRef.current?.value;
      if (currentSession) {
        currentSession.readbackError = `Category data could not be refreshed: ${failure.message}`;
        currentSession.stale = true;
      }
      refreshSessionView();
    }
  }, [refreshSessionView]);
  const coordinatorRef = useRef<ReturnType<typeof createCategoryMutationCoordinator> | null>(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = createCategoryMutationCoordinator(listCategories, applyRows, onRefreshFailure, () => userIdRef.current);
  }
  const coordinator = coordinatorRef.current;

  const replaceDraft = (next: CategoryDraft | null) => {
    draftRef.current = next;
    setDraft(next);
  };
  const replaceCategoryId = (next: string | null) => {
    categoryIdRef.current = next;
    setCategoryId(next);
  };
  const applyCanonicalDraft = useCallback((canonical: AdminCategory, savedVersions?: DraftVersions) => {
    const preserveFields = new Set<DraftField>();
    for (const field of DRAFT_FIELDS) {
      if (savedVersions
        ? draftVersionsRef.current[field] !== savedVersions[field]
        : dirtyFieldsRef.current.has(field)) {
        preserveFields.add(field);
      }
    }
    const reconciled = reconcileCategoryDraft(canonical, draftRef.current, preserveFields);
    dirtyFieldsRef.current = reconciled.dirtyFields;
    draftRef.current = reconciled.draft;
    setDraft(reconciled.draft);
  }, [dirtyFieldsRef, draftRef, draftVersionsRef, setDraft]);

  const load = useCallback(async (reset = false) => {
    if (coordinator.pending) return;
    const firstInitialization = reset && !session.initialized;
    if (reset) {
      setLoadError(null);
      rowsRef.current = null;
      setRows(null);
      if (firstInitialization) {
        session.initialized = true;
        categoryIdRef.current = isNewRoute ? null : id ?? null;
        draftRef.current = isNewRoute ? emptyDraft() : null;
        cityDraftRef.current = '';
        dirtyFieldsRef.current = new Set();
        draftVersionsRef.current = emptyDraftVersions();
        pendingSaveVersionsRef.current = null;
        setReadbackError(null);
        setStale(false);
        setFormError(null);
        setCityError(null);
      }
      setCategoryId(session.categoryId);
      setDraft(session.draft);
      setCityDraft(session.cityDraft);
      setReadbackError(session.readbackError);
      setStale(session.stale);
      setFormError(session.formError);
      setCityError(session.cityError);
    } else {
      setLoadError(null);
    }
    const result = await coordinator.refresh();
    if (result.status !== 'refreshed') return;
    const targetId = categoryIdRef.current;
    if (!targetId) {
      setReadbackError(null);
      setStale(false);
      return;
    }
    const canonical = result.rows.find((row) => row.id === targetId);
    if (canonical) {
      applyCanonicalDraft(canonical, pendingSaveVersionsRef.current ?? undefined);
      pendingSaveVersionsRef.current = null;
      setReadbackError(null);
      setStale(false);
      settleCategoryEditorSession(sessionKey, session);
    } else if (firstInitialization) {
      replaceDraft(null);
    } else {
      setReadbackError('The selected category was not returned by the canonical category list.');
      setStale(true);
    }
  }, [applyCanonicalDraft, coordinator, id, isNewRoute, session, sessionKey]);

  loadRef.current = load;
  useEffect(() => categoryMutationRegistry.subscribe((event) => {
    if (event.owner === coordinator.owner && event.ownerUserId === userId) {
      if (!event.pending) seenMutationRevisionRef.current = event.revision;
      return;
    }
    if (event.pending) {
      setExternalMutationPending(true);
      coordinator.invalidate();
      return;
    }
    setExternalMutationPending(false);
    refreshSessionView();
    if (focusedRef.current) {
      seenMutationRevisionRef.current = event.revision;
      void loadRef.current?.();
    }
  }), [coordinator, refreshSessionView, session]);
  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    if (seenMutationRevisionRef.current !== categoryMutationRegistry.revision) {
      seenMutationRevisionRef.current = categoryMutationRegistry.revision;
      void loadRef.current?.();
    }
    return () => { focusedRef.current = false; };
  }, []));

  useEffect(() => {
    if (!canEditCategories) {
      featureWasEnabledRef.current = false;
      return;
    }
    if (coordinator.pending) return;
    const reset = !initializedRouteRef.current
      || loadedRouteIdRef.current !== id
      || loadedSessionKeyRef.current !== sessionKey;
    const featureReenabled = !featureWasEnabledRef.current;
    featureWasEnabledRef.current = true;
    if (reset) {
      initializedRouteRef.current = true;
      loadedRouteIdRef.current = id;
      loadedSessionKeyRef.current = sessionKey;
      void load(true);
    } else if (featureReenabled) {
      void load(false);
    }
  }, [canEditCategories, coordinator, id, load, saving, savingCity, sessionKey]);

  const category = useMemo(() => rows?.find((row) => row.id === categoryId) ?? null, [rows, categoryId]);
  const groups = useMemo(
    () => (rows ?? []).filter((row) => row.id !== categoryId && row.parent_id == null && row.archetype == null).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [rows, categoryId],
  );
  const policyKeys = useMemo(
    () => [...new Set((rows ?? []).map((row) => row.cancellation_policy).filter(Boolean))].sort(),
    [rows],
  );

  const backToServices = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/admin/services');
  };

  const update = <K extends DraftField>(key: K, value: CategoryDraft[K]) => {
    const current = draftRef.current;
    if (!current) return;
    draftVersionsRef.current[key] += 1;
    dirtyFieldsRef.current.add(key);
    replaceDraft({ ...current, [key]: value });
  };

  const changeArchetype = (value: string) => {
    const current = draftRef.current;
    if (!current) return;
    draftVersionsRef.current.archetype += 1;
    dirtyFieldsRef.current.add('archetype');
    let parentId = current.parent_id;
    if (!value) {
      draftVersionsRef.current.parent_id += 1;
      dirtyFieldsRef.current.add('parent_id');
      parentId = '';
    }
    replaceDraft({ ...current, archetype: value, parent_id: parentId });
  };

  const saveCategory = async () => {
    const currentDraft = draftRef.current;
    const currentRows = rowsRef.current;
    const currentCategoryId = categoryIdRef.current;
    if (!currentDraft || !currentRows || stale || externalMutationPending || coordinator.pending) return;
    const mutationUserId = userIdRef.current;
    setFormError(null);
    let payload: AdminCategoryUpsert;
    const currentCategory = currentRows.find((row) => row.id === currentCategoryId) ?? null;
    try {
      const name = required(currentDraft.name, 'Name');
      const icon = required(currentDraft.icon, 'Icon');
      const vertical = required(currentDraft.vertical, 'Vertical');
      const cancellationPolicy = required(currentDraft.cancellation_policy, 'Cancellation policy');
      const parentId = currentDraft.archetype ? currentDraft.parent_id || null : null;
      const pricingUnits = parseList(currentDraft.pricing_units);
      if (pricingUnits.length === 0) throw new Error('Add at least one pricing unit.');
      const recurrenceSupported = currentDraft.archetype === 'fixed' || currentDraft.archetype === 'time_based';
      const recurrenceAllowed = recurrenceSupported && currentDraft.recurrence_allowed;
      const base = {
        name,
        icon,
        parent_id: parentId,
        vertical: required(currentDraft.vertical, 'Vertical'),
        archetype: currentDraft.archetype || null,
        pricing_units: pricingUnits,
        recurrence_allowed: recurrenceAllowed,
        allowed_frequencies: recurrenceAllowed ? parseList(currentDraft.allowed_frequencies) : [],
        recurring_discount_bp: recurrenceAllowed && currentDraft.recurring_discount_bp.trim()
          ? wholeNumber(currentDraft.recurring_discount_bp, 'Recurring discount (bp)', 0, 5000)
          : null,
        cancellation_policy: cancellationPolicy,
        requires_docs: parseList(currentDraft.requires_docs),
        restricted: currentDraft.restricted,
        sort_order: categorySortOrderForSave(currentCategory, currentRows, parentId),
        intake_schema: parseIntakeSchema(currentDraft.intake_schema),
      };
      if (currentCategoryId) {
        payload = { ...base, id: currentCategoryId };
      } else {
        const slug = required(currentDraft.slug, 'Slug');
        if (!/^[a-z0-9-]{3,60}$/.test(slug)) {
          throw new Error('Slug must be 3–60 lowercase letters, numbers, or hyphens.');
        }
        payload = { ...base, slug };
      }
    } catch (error) {
      setFormError((error as Error).message);
      return;
    }

    const savedVersions = { ...draftVersionsRef.current };
    let operationToken: symbol | null = null;
    try {
      const result = await coordinator.mutate(
        () => adminUpsertCategory(payload),
        (failure) => {
          setReadbackError(`Category saved, but canonical data could not be refreshed: ${failure.message}`);
          setStale(true);
        },
        (savedId) => {
          pendingSaveVersionsRef.current = savedVersions;
          replaceCategoryId(savedId);
        },
        'Category save',
        () => {
          if (operationToken !== null) clearOperation(operationToken);
        },
        (failure) => setFormError(failure.message),
        (savedId, canonicalRows) => {
          const canonicalCategory = canonicalRows.find((row) => row.id === savedId);
          if (!canonicalCategory) {
            const message = 'Category saved, but it was not returned by the canonical category list.';
            setReadbackError(message);
            setStale(true);
            return message;
          }
          applyCanonicalDraft(canonicalCategory, pendingSaveVersionsRef.current ?? savedVersions);
          pendingSaveVersionsRef.current = null;
          setReadbackError(null);
          setStale(false);
          if (userIdRef.current === mutationUserId) toast({ message: 'Category saved', tone: 'success' });
          settleCategoryEditorSession(sessionKey, session);
          return null;
        },
        () => { operationToken = beginOperation('save'); },
      );
      if (result.status === 'write-failed') {
        setFormError(result.error.message);
      }
    } finally {
      if (operationToken !== null) clearOperation(operationToken);
      settleCategoryEditorSession(sessionKey, session);
    }
  };

  const runCityMutation = async (
    city: string,
    write: () => Promise<unknown>,
    successMessage: string,
    onCommitted?: () => void,
  ) => {
    const currentCategoryId = categoryIdRef.current;
    if (!currentCategoryId || stale || externalMutationPending || coordinator.pending) return;
    const mutationUserId = userIdRef.current;
    setCityError(null);
    let operationToken: symbol | null = null;
    try {
      const result = await coordinator.mutate(
        write,
        (failure) => {
          setReadbackError(`${successMessage} was saved, but canonical data could not be refreshed: ${failure.message}`);
          setStale(true);
        },
        onCommitted ? () => onCommitted() : undefined,
        successMessage,
        () => {
          if (operationToken !== null) clearOperation(operationToken);
        },
        (failure) => setCityError(failure.message),
        (_value, canonicalRows) => {
          const canonical = canonicalRows.find((row) => row.id === currentCategoryId);
          if (!canonical) {
            const message = `${successMessage} was saved, but the category was not returned by the canonical category list.`;
            setReadbackError(message);
            setStale(true);
            return message;
          }
          applyCanonicalDraft(canonical);
          setReadbackError(null);
          setStale(false);
          if (userIdRef.current === mutationUserId) toast({ message: successMessage, tone: 'success' });
          settleCategoryEditorSession(sessionKey, session);
          return null;
        },
        () => { operationToken = beginOperation(`city:${city}`); },
      );
      if (result.status === 'write-failed') {
        setCityError(result.error.message);
      }
    } finally {
      if (operationToken !== null) clearOperation(operationToken);
      settleCategoryEditorSession(sessionKey, session);
    }
  };

  const addCity = async () => {
    const currentCategoryId = categoryIdRef.current;
    if (!currentCategoryId || stale || externalMutationPending || coordinator.pending) return;
    const city = cityDraft.trim();
    if (city.length < 2) {
      setCityError('Enter a city name with at least 2 characters.');
      return;
    }
    await runCityMutation(
      city,
      () => setCategoryCity(currentCategoryId, city, true),
      `${city} is available`,
      () => {
        setCityDraft((current) => clearSubmittedCityDraft(current, city));
      },
    );
  };

  const toggleCity = async (city: string, live: boolean) => {
    const currentCategoryId = categoryIdRef.current;
    if (!currentCategoryId || stale || externalMutationPending || coordinator.pending) return;
    await runCityMutation(
      city,
      () => setCategoryCity(currentCategoryId, city, live),
      `${city} availability updated`,
    );
  };

  const changeCityDraft = (value: string) => {
    setCityDraft(value);
  };

  return {
    canEditCategories,
    rows,
    draft,
    categoryId,
    category,
    groups,
    policyKeys,
    loadError,
    readbackError,
    stale,
    formError,
    cityError,
    cityDraft,
    saving,
    savingCity,
    externalMutationPending,
    operationSlow,
    load,
    backToServices,
    update,
    changeArchetype,
    changeCityDraft,
    saveCategory,
    addCity,
    toggleCity,
  };
}

export default function AdminCategoryEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const {
    canEditCategories,
    rows,
    draft,
    categoryId,
    category,
    groups,
    policyKeys,
    loadError,
    readbackError,
    stale,
    formError,
    cityError,
    cityDraft,
    saving,
    savingCity,
    externalMutationPending,
    operationSlow,
    load,
    backToServices,
    update,
    changeArchetype,
    changeCityDraft,
    saveCategory,
    addCity,
    toggleCity,
  } = useAdminCategoryDetailController(id);

  if (!canEditCategories) {
    return (
      <Screen header={<Header title="Category editor" onBack={backToServices} />}>
        <EmptyState
          title="Category editor unavailable"
          message="Category editing is turned off. Existing services remain available."
          secondaryLabel="Back to services"
          onSecondary={backToServices}
          icon="construct-outline"
        />
      </Screen>
    );
  }
  if (loadError) {
    return <Screen header={<Header title="Category editor" onBack={backToServices} />}><ErrorState message={loadError} onRetry={load} /></Screen>;
  }
  if (!rows) {
    return <Screen header={<Header title="Category editor" onBack={backToServices} />}><Skeleton height={520} radius={t.radii.lg} /></Screen>;
  }
  if (!draft) {
    return (
      <Screen header={<Header title="Category editor" onBack={backToServices} />}>
        <EmptyState title="Category not found" message="This category may have been removed." actionLabel="Back to services" onAction={backToServices} icon="search-outline" />
      </Screen>
    );
  }

  return (
    <Screen header={<Header title={category ? 'Edit service' : categoryId ? 'Edit service' : 'New service'} subtitle={category?.name ?? undefined} onBack={backToServices} />}>
      <Card gap={t.spacing.md}>
        <Text variant="title3">Basics</Text>
        <Input label="Name" value={draft.name} onChangeText={(value) => update('name', value)} />
        <Input
          label="Slug"
          value={draft.slug}
          editable={!categoryId}
          helper={categoryId ? 'Slug cannot be changed after creation.' : '3–60 lowercase letters, numbers, or hyphens.'}
          onChangeText={(value) => update('slug', value)}
          autoCapitalize="none"
        />
        <Input label="Icon key" value={draft.icon} placeholder="construct-outline" onChangeText={(value) => update('icon', value)} autoCapitalize="none" />
        <Input label="Vertical" value={draft.vertical} placeholder="home-repairs" onChangeText={(value) => update('vertical', value)} autoCapitalize="none" />
        {draft.archetype ? (
          <View style={{ gap: t.spacing.sm }}>
            <Text variant="subhead">Parent group</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
              <Button
                title="No parent"
                size="sm"
                variant={draft.parent_id ? 'outline' : 'secondary'}
                onPress={() => update('parent_id', '')}
              />
              {groups.map((group) => (
                <Button
                  key={group.id}
                  title={group.name}
                  size="sm"
                  variant={draft.parent_id === group.id ? 'secondary' : 'outline'}
                  onPress={() => update('parent_id', group.id)}
                />
              ))}
            </View>
          </View>
        ) : null}
      </Card>

      <Card gap={t.spacing.md}>
        <Text variant="title3">Booking type</Text>
        <Text variant="subhead">Category type</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
          {ARCHETYPES.map((option) => (
            <Button
              key={option.value || 'group'}
              title={option.label}
              size="sm"
              variant={draft.archetype === option.value ? 'secondary' : 'outline'}
              disabled={saving || stale || externalMutationPending}
              onPress={() => changeArchetype(option.value)}
            />
          ))}
        </View>
        <Input
          label="Pricing units"
          value={draft.pricing_units}
          onChangeText={(value) => update('pricing_units', value)}
          helper="Comma-separated units, such as job, hour, visit, or piece."
          autoCapitalize="none"
        />
        <Input
          label="Cancellation policy key"
          value={draft.cancellation_policy}
          onChangeText={(value) => update('cancellation_policy', value)}
          helper={policyKeys.length ? `Existing keys: ${policyKeys.join(', ')}` : 'Enter an existing policy key.'}
          autoCapitalize="none"
        />
        <TextArea
          label="Intake schema (JSON object)"
          value={draft.intake_schema}
          onChangeText={(value) => update('intake_schema', value)}
          helper="Use safe service-intake fields only; do not include phone numbers or addresses."
          autoCapitalize="none"
          autoCorrect={false}
          showCount={false}
        />
      </Card>

      {draft.archetype === 'fixed' || draft.archetype === 'time_based' ? (
        <Card gap={t.spacing.md}>
          <Text variant="title3">Recurring</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.md }}>
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">Allow recurring bookings</Text>
              <Text variant="caption" color="muted">The server enforces the category and global recurrence rules.</Text>
            </View>
            <Switch
              accessibilityLabel="Allow recurring bookings"
              value={draft.recurrence_allowed}
              onValueChange={(value) => update('recurrence_allowed', value)}
            />
          </View>
          {draft.recurrence_allowed ? (
            <>
              <Input
                label="Allowed frequencies"
                value={draft.allowed_frequencies}
                onChangeText={(value) => update('allowed_frequencies', value)}
                helper="Comma-separated; values must be in the global recurring rules."
                autoCapitalize="none"
              />
              <Input
                label="Recurring discount (bp)"
                keyboardType="number-pad"
                value={draft.recurring_discount_bp}
                onChangeText={(value) => update('recurring_discount_bp', value)}
                helper="Leave blank to use the global rule default; maximum 5000 bp."
              />
            </>
          ) : null}
        </Card>
      ) : null}

      <Card gap={t.spacing.md}>
        <Text variant="title3">Verification</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">Restricted category</Text>
            <Text variant="caption" color="muted">Restricted categories need required verification documents before activation.</Text>
          </View>
          <Switch
            accessibilityLabel="Restricted category"
            value={draft.restricted}
            onValueChange={(value) => update('restricted', value)}
          />
        </View>
        <Input
          label="Required documents"
          value={draft.requires_docs}
          onChangeText={(value) => update('requires_docs', value)}
          helper="Comma-separated document keys."
          autoCapitalize="none"
        />
      </Card>

      <Card gap={t.spacing.md}>
        <Text variant="title3">Cities</Text>
        {categoryId ? (
          <>
            <Input
              label="Add city"
              value={cityDraft}
              onChangeText={changeCityDraft}
              placeholder="City name"
              autoCapitalize="words"
            />
            <Button
              title="Add city as live"
              size="sm"
              variant="outline"
              disabled={savingCity !== null || saving || stale || externalMutationPending}
              loading={savingCity === cityDraft.trim()}
              onPress={() => void addCity()}
            />
            {category ? category.cities.length ? category.cities.map((city) => (
              <View key={city.city} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.md }}>
                <Text variant="footnote">{city.city}</Text>
                <Switch
                  accessibilityLabel={`${city.city} availability`}
                  value={city.live}
                  disabled={savingCity !== null || saving || stale || externalMutationPending}
                  onValueChange={(live) => void toggleCity(city.city, live)}
                />
              </View>
            )) : <EmptyState compact title="No city availability configured" icon="location-outline" />
              : <Text variant="footnote" color="muted">Category details are unavailable until refresh completes.</Text>}
          </>
        ) : (
          <Text variant="footnote" color="muted">Save the category first, then add its city availability.</Text>
        )}
        <InlineAlert message={cityError} />
      </Card>

      <InlineAlert message={formError} />
      <InlineAlert message={readbackError} />
      {operationSlow ? (
        <InlineAlert message="The server has not confirmed this category change. Its outcome is unknown; do not retry. Category reads and writes stay blocked until it settles. If it remains stuck, restart the app, then verify the category in Services before retrying." />
      ) : null}
      {externalMutationPending ? (
        <InlineAlert message="Another category change is in progress. This editor will refresh when it finishes." />
      ) : null}
      {readbackError ? (
        <Button
          title="Refresh category data"
          disabled={saving || savingCity !== null || externalMutationPending}
          onPress={() => void load()}
        />
      ) : null}
      <Button title="Save category" disabled={saving || savingCity !== null || stale || externalMutationPending} loading={saving} onPress={() => void saveCategory()} />
    </Screen>
  );
}
