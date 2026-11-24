import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Switch, View } from 'react-native';
import { Badge, Button, Card, EmptyState, ErrorState, Header, InlineAlert, Input, Screen, SegmentedControl, Skeleton, Text, useToast } from '../../components/ui';
import { onAuthChange } from '../../lib/api';
import { adminReorderCategories, listCategories, setCategoryActive, setCategoryCity, type AdminCategory } from '../../lib/adminApi';
import { useAuth } from '../../lib/auth';
import { useFeature } from '../../lib/featureFlags';
import { useTheme } from '../../theme';

export const CATEGORY_MUTATION_SLOW_WARNING_MS = 60_000;

export function categoryMutationWarningDelay(startedAt: number, now = Date.now()): number {
  return Math.max(0, CATEGORY_MUTATION_SLOW_WARNING_MS - (now - startedAt));
}

export function resolveCategorySessionUserId(
  reportedUserId: string | null,
  registryUserId: string | null,
  identityKnown: boolean,
): string | null {
  return identityKnown ? registryUserId : reportedUserId ?? registryUserId;
}

export interface CategoryMutationEvent {
  owner: symbol;
  pending: boolean;
  revision: number;
  status: 'pending' | 'saved' | 'write-failed' | 'readback-failed' | 'cleared';
  message: string;
  userId: string | null;
  ownerUserId: string | null;
  startedAt: number;
}

type CategoryMutationOutcome = Exclude<CategoryMutationEvent['status'], 'pending' | 'cleared'>;
type CategoryMutationListener = (event: CategoryMutationEvent) => void;
const categoryMutationListeners = new Set<CategoryMutationListener>();
const categoryMutationUserCleanups = new Set<(userId: string | null) => void>();
let activeCategoryMutation: symbol | null = null;
let activeCategoryMutationUserId: string | null = null;
let activeCategoryMutationStartedAt: number | null = null;
let categoryMutationRevision = 0;
let lastCategoryMutationEvent: CategoryMutationEvent | null = null;
let categoryMutationUserId: string | null = null;
let categoryAuthIdentityKnown = false;
let categoryAuthUnsubscribe: (() => void) | null = null;
let acknowledgedMutationRevision = 0;
const userChangeOwner = Symbol('category-mutation-user-change');

function notifyCategoryMutationListeners(event: CategoryMutationEvent): void {
  for (const listener of categoryMutationListeners) {
    try {
      listener(event);
    } catch {
      continue;
    }
  }
}

export const categoryMutationRegistry = {
  get pending() {
    return activeCategoryMutation !== null;
  },
  get owner() {
    return activeCategoryMutation;
  },
  get revision() {
    return categoryMutationRevision;
  },
  get userId() {
    return categoryMutationUserId;
  },
  get identityKnown() {
    return categoryAuthIdentityKnown;
  },
  get lastOutcome() {
    return lastCategoryMutationEvent;
  },
  get acknowledgedRevision() {
    return acknowledgedMutationRevision;
  },
  begin(owner: symbol, label: string, userId: string | null): boolean {
    if (activeCategoryMutation !== null) return false;
    const startedAt = Date.now();
    activeCategoryMutation = owner;
    activeCategoryMutationUserId = userId;
    activeCategoryMutationStartedAt = startedAt;
    const event: CategoryMutationEvent = {
      owner,
      pending: true,
      revision: categoryMutationRevision,
      status: 'pending',
      message: `${label} is in progress.`,
      userId,
      ownerUserId: userId,
      startedAt,
    };
    lastCategoryMutationEvent = event;
    notifyCategoryMutationListeners(event);
    return true;
  },
  finish(owner: symbol, status: CategoryMutationOutcome, message: string): void {
    if (activeCategoryMutation !== owner) return;
    activeCategoryMutation = null;
    const userId = activeCategoryMutationUserId;
    const startedAt = activeCategoryMutationStartedAt ?? Date.now();
    activeCategoryMutationUserId = null;
    activeCategoryMutationStartedAt = null;
    categoryMutationRevision += 1;
    const event: CategoryMutationEvent = {
      owner,
      pending: false,
      revision: categoryMutationRevision,
      status,
      message,
      userId,
      ownerUserId: userId,
      startedAt,
    };
    lastCategoryMutationEvent = event;
    notifyCategoryMutationListeners(event);
  },
  startAuthTracking(): void {
    if (categoryAuthUnsubscribe) return;
    categoryAuthUnsubscribe = onAuthChange((session) => {
      categoryMutationRegistry.setUser(session?.userId ?? null, true);
    });
  },
  setUser(userId: string | null, authoritative = false): void {
    if (authoritative) categoryAuthIdentityKnown = true;
    if (!authoritative && categoryAuthIdentityKnown) return;
    if (!authoritative && userId === null && categoryMutationUserId !== null) return;
    if (categoryMutationUserId === userId) return;
    const previousUserId = categoryMutationUserId;
    for (const cleanup of categoryMutationUserCleanups) {
      try {
        cleanup(previousUserId);
      } catch {
        continue;
      }
    }
    categoryMutationUserId = userId;
    categoryMutationRevision += 1;
    acknowledgedMutationRevision = categoryMutationRevision;
    const pending = activeCategoryMutation !== null;
    const startedAt = activeCategoryMutationStartedAt ?? Date.now();
    lastCategoryMutationEvent = pending
      ? {
        owner: activeCategoryMutation!,
        pending: true,
        revision: categoryMutationRevision,
        status: 'pending',
        message: 'A category change is in progress.',
        userId: activeCategoryMutationUserId,
        ownerUserId: activeCategoryMutationUserId,
        startedAt,
      }
      : null;
    notifyCategoryMutationListeners({
      owner: activeCategoryMutation ?? userChangeOwner,
      pending,
      revision: categoryMutationRevision,
      status: 'cleared',
      message: '',
      userId,
      ownerUserId: activeCategoryMutationUserId,
      startedAt,
    });
  },
  registerUserCleanup(cleanup: (userId: string | null) => void): () => void {
    categoryMutationUserCleanups.add(cleanup);
    return () => categoryMutationUserCleanups.delete(cleanup);
  },
  acknowledge(revision: number): void {
    acknowledgedMutationRevision = Math.max(acknowledgedMutationRevision, revision);
  },
  subscribe(listener: CategoryMutationListener): () => void {
    categoryMutationListeners.add(listener);
    return () => categoryMutationListeners.delete(listener);
  },
};

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
  const owner = Symbol('admin-category-mutation');
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
    async refresh(): Promise<{ status: 'refreshed' | 'busy' | 'stale' | 'failed'; error?: Error }> {
      if (pending || categoryMutationRegistry.pending) return { status: 'busy' };
      const request = ++generation;
      try {
        const rows = await read();
        if (request !== generation) return { status: 'stale' };
        apply(rows);
        return { status: 'refreshed' };
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
    ): Promise<CategoryMutationResult<T>> {
      if (pending) return { status: 'busy' };
      pending = true;
      if (!categoryMutationRegistry.begin(owner, label, userId())) {
        pending = false;
        return { status: 'busy' };
      }
      const request = ++generation;
      let outcome: CategoryMutationOutcome = 'write-failed';
      let outcomeMessage = `${label} ended before the write was confirmed.`;
      try {
        let value: T;
        try {
          value = await write();
        } catch (error) {
          const failure = asError(error);
          outcomeMessage = `${label} failed: ${failure.message}`;
          return { status: 'write-failed', error: failure };
        }
        try {
          onCommitted?.(value);
          const rows = await read();
          if (request !== generation) {
            outcome = 'readback-failed';
            outcomeMessage = `${label} was saved, but a newer category request superseded its readback.`;
            return { status: 'stale' };
          }
          apply(rows);
          outcome = 'saved';
          outcomeMessage = `${label} saved.`;
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
        categoryMutationRegistry.finish(owner, outcome, outcomeMessage);
      }
    },
  };
}

export function reorderSiblingIds(
  rows: AdminCategory[],
  category: AdminCategory,
  offset: -1 | 1,
): string[] | null {
  const siblings = rows
    .filter((row) => row.parent_id === category.parent_id)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const currentIndex = siblings.findIndex((row) => row.id === category.id);
  const nextIndex = currentIndex + offset;
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= siblings.length) return null;
  const [moved] = siblings.splice(currentIndex, 1);
  siblings.splice(nextIndex, 0, moved!);
  return siblings.map((row) => row.id);
}

export function useAdminServicesController() {
  const toast = useToast();
  const { userId } = useAuth();
  const sessionUserId = resolveCategorySessionUserId(
    userId,
    categoryMutationRegistry.userId,
    categoryMutationRegistry.identityKnown,
  );
  const canEditCategories = useFeature('admin_category_editor');
  const [rows, setRows] = useState<AdminCategory[] | null>(null);
  const rowsRef = useRef<AdminCategory[] | null>(null);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [staleError, setStaleError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [externalMutationPending, setExternalMutationPending] = useState(categoryMutationRegistry.pending);
  const [externalMutationNotice, setExternalMutationNotice] = useState<string | null>(null);
  const [externalMutationSlow, setExternalMutationSlow] = useState(false);
  const [localMutationSlow, setLocalMutationSlow] = useState(false);
  const focusedRef = useRef(false);
  const loadRef = useRef<(() => Promise<unknown>) | null>(null);
  const userIdRef = useRef(sessionUserId);
  const slowWarningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  userIdRef.current = sessionUserId;

  const applyRows = useCallback((next: AdminCategory[]) => {
    rowsRef.current = next;
    setRows(next);
    setError(null);
    setStaleError(null);
  }, []);
  const onRefreshFailure = useCallback((failure: Error) => {
    if (rowsRef.current === null) setError(failure.message);
    else setStaleError(`Category data could not be refreshed: ${failure.message}`);
  }, []);
  const coordinatorRef = useRef<ReturnType<typeof createCategoryMutationCoordinator> | null>(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = createCategoryMutationCoordinator(listCategories, applyRows, onRefreshFailure, () => userIdRef.current);
  }
  const coordinator = coordinatorRef.current;
  const load = useCallback(() => coordinator.refresh(), [coordinator]);
  loadRef.current = load;
  useEffect(() => {
    if (saving === null) {
      setLocalMutationSlow(false);
      return;
    }
    const timer = setTimeout(() => setLocalMutationSlow(true), CATEGORY_MUTATION_SLOW_WARNING_MS);
    return () => clearTimeout(timer);
  }, [saving]);
  const startSlowWarning = useCallback((startedAt: number) => {
    if (slowWarningTimerRef.current) clearTimeout(slowWarningTimerRef.current);
    setExternalMutationSlow(false);
    const remaining = categoryMutationWarningDelay(startedAt);
    slowWarningTimerRef.current = setTimeout(
      () => setExternalMutationSlow(true),
      remaining,
    );
  }, []);
  useEffect(() => {
    const unsubscribe = categoryMutationRegistry.subscribe((event) => {
      if (event.status === 'cleared') {
        setExternalMutationNotice(null);
        const external = event.pending
          && (event.owner !== coordinator.owner || event.ownerUserId !== sessionUserId);
        setExternalMutationPending(external);
        if (external) {
          coordinator.invalidate();
          startSlowWarning(event.startedAt);
        } else {
          if (slowWarningTimerRef.current) clearTimeout(slowWarningTimerRef.current);
          setExternalMutationSlow(false);
        }
        if (!event.pending && focusedRef.current) void loadRef.current?.();
        return;
      }
      if (event.pending) {
        const external = event.owner !== coordinator.owner || event.ownerUserId !== sessionUserId;
        setExternalMutationPending(external);
        if (external) {
          setExternalMutationNotice(event.userId === sessionUserId ? event.message : 'A category change is in progress.');
          coordinator.invalidate();
          startSlowWarning(event.startedAt);
        }
        return;
      }
      setExternalMutationPending(false);
      if (slowWarningTimerRef.current) clearTimeout(slowWarningTimerRef.current);
      setExternalMutationSlow(false);
      if (event.owner !== coordinator.owner || event.ownerUserId !== sessionUserId) {
        setExternalMutationNotice(event.userId === sessionUserId ? event.message : null);
        if (focusedRef.current) void loadRef.current?.();
      }
    });
    const lastOutcome = categoryMutationRegistry.lastOutcome;
    if (lastOutcome?.pending && lastOutcome.owner !== coordinator.owner) {
      startSlowWarning(lastOutcome.startedAt);
    }
    return () => {
      unsubscribe();
      if (slowWarningTimerRef.current) clearTimeout(slowWarningTimerRef.current);
    };
  }, [coordinator, startSlowWarning, sessionUserId]);
  useEffect(() => {
    const lastOutcome = categoryMutationRegistry.lastOutcome;
    if (lastOutcome && lastOutcome.owner !== coordinator.owner
      && lastOutcome.userId === sessionUserId
      && lastOutcome.revision > categoryMutationRegistry.acknowledgedRevision) {
      setExternalMutationNotice(lastOutcome.message);
    }
  }, [coordinator, sessionUserId]);
  useEffect(() => {
    categoryMutationRegistry.startAuthTracking();
    categoryMutationRegistry.setUser(sessionUserId);
  }, [sessionUserId]);
  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    void load();
    return () => { focusedRef.current = false; };
  }, [load]));

  const visible = useMemo(() => (rows ?? []).filter((r) =>
    (filter === 'all' || r.archetype === filter) && (!q || `${r.name} ${r.slug}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (a.parent_id ?? '').localeCompare(b.parent_id ?? '') || a.sort_order - b.sort_order || a.name.localeCompare(b.name)), [rows, filter, q]);

  const runMutation = useCallback(async (
    key: string,
    write: () => Promise<unknown>,
    successMessage: string,
  ) => {
    if (coordinator.pending || externalMutationPending || staleError) return;
    const mutationUserId = userIdRef.current;
    setExternalMutationNotice(null);
    setSaving(key);
    try {
      const result = await coordinator.mutate(
        write,
        (failure) => setStaleError(`${successMessage} succeeded, but category data could not be refreshed: ${failure.message}`),
        undefined,
        successMessage,
      );
      if (result.status === 'write-failed') {
        if (userIdRef.current === mutationUserId) {
          toast({ message: result.error.message, tone: 'error' });
        }
      } else if (result.status === 'committed') {
        if (userIdRef.current === mutationUserId) {
          toast({ message: successMessage, tone: 'success' });
        }
      }
    } finally {
      setSaving(null);
    }
  }, [coordinator, externalMutationPending, staleError, toast]);

  const dismissExternalMutationNotice = useCallback(() => {
    const lastOutcome = categoryMutationRegistry.lastOutcome;
    if (lastOutcome?.userId === sessionUserId) categoryMutationRegistry.acknowledge(lastOutcome.revision);
    setExternalMutationNotice(null);
  }, [sessionUserId]);

  const categoryToggle = useCallback((r: AdminCategory, active: boolean) =>
    runMutation(r.id, () => setCategoryActive(r.id, active), `${r.name} ${active ? 'enabled' : 'disabled'}`),
  [runMutation]);

  const cityToggle = useCallback((r: AdminCategory, city: string, live: boolean) =>
    runMutation(`${r.id}:${city}`, () => setCategoryCity(r.id, city, live), `${city} availability updated`),
  [runMutation]);

  const moveCategory = useCallback((category: AdminCategory, offset: -1 | 1) => {
    const ids = reorderSiblingIds(rowsRef.current ?? [], category, offset);
    if (!ids) return;

    return runMutation(
      `order:${category.parent_id ?? 'root'}`,
      () => adminReorderCategories(ids),
      'Category order saved',
    );
  }, [runMutation]);

  const parentNames = useMemo(
    () => new Map<string, string>((rows ?? []).map((row) => [row.id, row.name])),
    [rows],
  );

  return {
    rows,
    filter,
    setFilter,
    q,
    setQ,
    error,
    staleError,
    externalMutationPending,
    externalMutationNotice,
    externalMutationSlow,
    localMutationSlow,
    dismissExternalMutationNotice,
    saving,
    canEditCategories,
    visible,
    parentNames,
    load,
    categoryToggle,
    cityToggle,
    moveCategory,
  };
}

export default function AdminServicesScreen() {
  const t = useTheme();
  const router = useRouter();
  const {
    rows,
    filter,
    setFilter,
    q,
    setQ,
    error,
    staleError,
    externalMutationPending,
    externalMutationNotice,
    externalMutationSlow,
    localMutationSlow,
    dismissExternalMutationNotice,
    saving,
    canEditCategories,
    visible,
    parentNames,
    load,
    categoryToggle,
    cityToggle,
    moveCategory,
  } = useAdminServicesController();

  return (
    <Screen header={<Header title="Services" subtitle={`${rows?.length ?? 0} categories`} />}>
      {canEditCategories && rows && rows.length > 0 ? (
        <Button
          title="New service"
          leftIcon="add"
          disabled={saving !== null || externalMutationPending || staleError !== null}
          onPress={() => router.push('/admin/category/new')}
        />
      ) : null}
      <Input label="Search" placeholder="Service name" value={q} onChangeText={setQ} />
      <SegmentedControl
        options={[{ value: 'all', label: 'All' }, { value: 'inspect_quote', label: 'Repairs' }, { value: 'fixed', label: 'Fixed' }, { value: 'proposal', label: 'Creators' }]}
        value={filter}
        onChange={setFilter}
      />
      {staleError ? (
        <>
          <InlineAlert message={staleError} />
          <Button title="Refresh category data" disabled={saving !== null || externalMutationPending} onPress={() => void load()} />
        </>
      ) : null}
      {saving !== null && localMutationSlow ? (
        <InlineAlert message="The server has not confirmed this category change. Its outcome is unknown; do not retry. Category actions remain locked until the request settles." />
      ) : null}
      {externalMutationPending && externalMutationSlow ? (
        <InlineAlert message="The server has not confirmed this category change. Its outcome is unknown; do not retry. Category reads and writes stay blocked until it settles. If it remains stuck, restart the app, then verify the category in Services before retrying." />
      ) : externalMutationPending ? (
        <InlineAlert message={externalMutationNotice ?? 'Another category change is being saved. This list will refresh when it finishes.'} />
      ) : externalMutationNotice ? (
        <>
          <InlineAlert message={externalMutationNotice} />
          <Button title="Dismiss category update notice" onPress={dismissExternalMutationNotice} />
        </>
      ) : null}
      {error ? <ErrorState message={error} onRetry={load} /> : !rows ? <Skeleton height={400} radius={t.radii.lg} /> : visible.length === 0 ? (
        <EmptyState
          title={rows.length === 0 ? 'No services yet' : 'No matching services'}
          message={rows.length === 0 ? 'Add a service category to start building the catalogue.' : 'Try a different search or category filter.'}
          actionLabel={rows.length === 0 && canEditCategories && !externalMutationPending && !staleError ? 'New service' : undefined}
          onAction={rows.length === 0 && canEditCategories && !externalMutationPending && !staleError ? () => router.push('/admin/category/new') : undefined}
          icon="grid-outline"
        />
      ) : visible.map((r) => {
        const siblings = (rows ?? [])
          .filter((row) => row.parent_id === r.parent_id)
          .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
        const siblingIndex = siblings.findIndex((row) => row.id === r.id);
        const orderKey = `order:${r.parent_id ?? 'root'}`;
        const parentName = r.parent_id ? parentNames.get(r.parent_id) : null;
        const kind = r.archetype ? r.archetype.replace('_', ' ') : 'Group';
        return (
        <Card key={r.id} gap={t.spacing.md}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text variant="calloutStrong">{r.name}</Text>
              <Text variant="caption" color="muted">
                {parentName ? `${parentName} · ` : ''}{kind} · {r.providers} providers · {r.bookings_30d} bookings / 30d
              </Text>
            </View>
            <Badge label={r.active ? 'On' : 'Off'} tone={r.active ? 'success' : 'neutral'} />
            <Switch
              accessibilityLabel={`${r.name} active`}
              value={r.active}
              disabled={saving !== null || externalMutationPending || staleError !== null}
              onValueChange={(v) => void categoryToggle(r, v)}
            />
          </View>
          {canEditCategories ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
                <Button
                  title="Edit"
                  size="sm"
                  variant="outline"
                  disabled={saving !== null || externalMutationPending || staleError !== null}
                  onPress={() => router.push(`/admin/category/${r.id}`)}
                />
                <Button
                  title="Move up"
                  size="sm"
                  variant="ghost"
                  disabled={siblingIndex <= 0 || saving !== null || externalMutationPending || staleError !== null || saving === orderKey}
                  onPress={() => void moveCategory(r, -1)}
                />
                <Button
                  title="Move down"
                  size="sm"
                  variant="ghost"
                  disabled={siblingIndex < 0 || siblingIndex >= siblings.length - 1 || saving !== null || externalMutationPending || staleError !== null || saving === orderKey}
                  onPress={() => void moveCategory(r, 1)}
                />
              </View>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {r.cities.map((c) => (
              <View key={c.city} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text variant="footnote">{c.city}</Text>
                <Switch
                  style={{ transform: [{ scale: 0.8 }] }}
                  value={c.live}
                  disabled={saving !== null || externalMutationPending || staleError !== null}
                  onValueChange={(v) => void cityToggle(r, c.city, v)}
                />
              </View>
            ))}
          </View>
        </Card>
        );
      })}
    </Screen>
  );
}
