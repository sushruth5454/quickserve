import { useCallback, useEffect, useRef, useState } from 'react';
import { Switch, View } from 'react-native';
import { Button, Card, Header, InlineAlert, Input, ListItem, Screen, Skeleton, Text, useToast } from '../../components/ui';
import { resolvePlace, searchPlaces, type PlaceResult } from '../../lib/locationContext';
import { newPlacesSession } from '../../lib/places';
import { listGeography, upsertGeo, type GeoKind, type GeographyTree } from '../../lib/geographyApi';
import { useEntityRefresh } from '../../lib/useEntityRefresh';
import { useTheme } from '../../theme';

type Draft = { kind: 'state' | 'district' | 'city'; parentId: string | null; name: string };
type LoadState = 'loading' | 'data' | 'error' | 'stale';
type AreaRequest = {
  cityId: string;
  query: string;
  sessionToken: string;
  requestGeneration: number;
};
type PlaceSearch = AreaRequest & { results: PlaceResult[] };
type PendingArea = AreaRequest & { name: string; lat: number; lng: number };
type LoadGuard = { isCurrent: () => boolean };

export default function AdminGeographyScreen() {
  const {
    t,
    tree,
    loadState,
    error,
    draft,
    setDraft,
    saving,
    areaCityId,
    areaQuery,
    placeResults,
    placeBusy,
    areaError,
    pendingArea,
    load,
    addNode,
    toggleNode,
    startAreaEntry,
    changeAreaQuery,
    searchArea,
    pickPlace,
    addArea,
    updatePendingAreaName,
    isCurrentSearch,
    isCurrentPendingArea,
    renderDraft,
  } = useAdminGeographyController();

  return (
    <Screen header={<Header title="Geography" subtitle="States · districts · cities · areas" />}>
      {error ? (
        <InlineAlert
          message={loadState === 'stale' ? `${error} Showing the last loaded geography.` : error}
          actionLabel="Retry"
          onAction={() => void load()}
        />
      ) : null}
      {!tree ? (
        loadState === 'loading' ? <Skeleton height={360} radius={t.radii.lg} /> : null
      ) : (
        <View style={{ gap: t.spacing.md }}>
          <Card gap={t.spacing.md}>
            <Text variant="calloutStrong">Managed locations</Text>
            <Button
              title="Add state"
              variant="outline"
              onPress={() => setDraft({ kind: 'state', parentId: null, name: '' })}
            />
            {renderDraft('state', null)}
          </Card>
          {tree.states.map((state) => {
            const districts = tree.districts.filter((district) => district.state_id === state.id);
            return (
              <Card key={state.id} gap={t.spacing.md}>
                <ToggleRow
                  title={state.name}
                  active={state.active}
                  disabled={saving === state.id}
                  onChange={(active) => void toggleNode('state', state.id, null, state.name, null, null, active)}
                />
                <Button
                  title={`Add district to ${state.name}`}
                  variant="ghost"
                  onPress={() => setDraft({ kind: 'district', parentId: state.id, name: '' })}
                />
                {renderDraft('district', state.id)}
                {districts.map((district) => {
                  const cities = tree.cities.filter((city) => city.district_id === district.id);
                  return (
                    <Card key={district.id} gap={t.spacing.md} padding={t.spacing.md}>
                      <ToggleRow
                        title={district.name}
                        active={district.active}
                        disabled={saving === district.id}
                        onChange={(active) => void toggleNode('district', district.id, state.id, district.name, null, null, active)}
                      />
                      <Button
                        title={`Add city to ${district.name}`}
                        variant="ghost"
                        onPress={() => setDraft({ kind: 'city', parentId: district.id, name: '' })}
                      />
                      {renderDraft('city', district.id)}
                      {cities.map((city) => {
                        const areas = tree.areas.filter((area) => area.city_id === city.id);
                        const currentPlaceSearch = isCurrentSearch(placeResults, city.id) ? placeResults : null;
                        const currentPendingArea = isCurrentPendingArea(pendingArea, city.id) ? pendingArea : null;
                        return (
                          <Card key={city.id} gap={t.spacing.sm} padding={t.spacing.md}>
                            <ToggleRow
                              title={city.name}
                              active={city.active}
                              disabled={saving === city.id}
                              onChange={(active) =>
                                void toggleNode('city', city.id, district.id, city.name, city.lat, city.lng, active)
                              }
                            />
                            <Button
                              title={areaCityId === city.id ? 'Close area search' : `Add area to ${city.name}`}
                              variant="ghost"
                              onPress={() => startAreaEntry(city.id)}
                            />
                            {areaCityId === city.id ? (
                              <View style={{ gap: t.spacing.sm }}>
                                <Text variant="caption" color="muted">Find a place to use its verified name and coordinates.</Text>
                                <Input
                                  label="Search places"
                                  placeholder={`Area in ${city.name}`}
                                  value={areaQuery}
                                  onChangeText={changeAreaQuery}
                                  onSubmitEditing={() => void searchArea(city.id, city.name)}
                                  returnKeyType="search"
                                />
                                <Button
                                  title="Search places"
                                  variant="outline"
                                  onPress={() => void searchArea(city.id, city.name)}
                                  loading={placeBusy}
                                  disabled={areaQuery.trim().length < 3}
                                />
                                {areaError ? <InlineAlert message={areaError} /> : null}
                                {currentPlaceSearch ? currentPlaceSearch.results.map((result, index) => (
                                  <ListItem
                                    key={result.placeId ?? `${result.title}:${index}`}
                                    icon="location-outline"
                                    title={result.title}
                                    subtitle={result.subtitle}
                                    onPress={() => void pickPlace(result, currentPlaceSearch)}
                                  />
                                )) : null}
                                {currentPendingArea ? (
                                  <>
                                    <Input
                                      label="Area name"
                                      value={currentPendingArea.name}
                                      onChangeText={(name) => updatePendingAreaName(city.id, currentPendingArea, name)}
                                      maxLength={80}
                                    />
                                    <Text variant="caption" color="muted">
                                      Coordinates: {currentPendingArea.lat.toFixed(5)}, {currentPendingArea.lng.toFixed(5)}
                                    </Text>
                                    <Button
                                      title="Save area"
                                      onPress={() => void addArea(city.id, currentPendingArea)}
                                      loading={saving === `new:area:${city.id}`}
                                      disabled={!currentPendingArea.name.trim()}
                                    />
                                  </>
                                ) : null}
                              </View>
                            ) : null}
                            {areas.map((area) => (
                              <ToggleRow
                                key={area.id}
                                title={area.name}
                                active={area.active}
                                disabled={saving === area.id}
                                onChange={(active) =>
                                  void toggleNode('area', area.id, city.id, area.name, area.lat, area.lng, active)
                                }
                              />
                            ))}
                          </Card>
                        );
                      })}
                    </Card>
                  );
                })}
              </Card>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

function useAdminGeographyController() {
  const t = useTheme();
  const toast = useToast();
  const [tree, setTree] = useState<GeographyTree | null>(null);
  const treeRef = useRef<GeographyTree | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [areaCityId, setAreaCityId] = useState<string | null>(null);
  const areaCityIdRef = useRef<string | null>(null);
  const [areaQuery, setAreaQuery] = useState('');
  const areaQueryRef = useRef('');
  const [placeResults, setPlaceResults] = useState<PlaceSearch | null>(null);
  const [placeBusy, setPlaceBusy] = useState(false);
  const [areaError, setAreaError] = useState<string | null>(null);
  const [pendingArea, setPendingArea] = useState<PendingArea | null>(null);
  const sessionRef = useRef(newPlacesSession());
  const requestGenerationRef = useRef(0);
  const loadGenerationRef = useRef(0);
  const mountedRef = useRef(false);

  const load = useCallback(async (guard?: LoadGuard) => {
    const request = ++loadGenerationRef.current;
    if (!treeRef.current) {
      setLoadState('loading');
      setError(null);
    }
    try {
      const next = await listGeography();
      if (!mountedRef.current || request !== loadGenerationRef.current || (guard && !guard.isCurrent())) return;
      treeRef.current = next;
      setTree(next);
      setLoadState('data');
      setError(null);
    } catch (cause) {
      if (!mountedRef.current || request !== loadGenerationRef.current || (guard && !guard.isCurrent())) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      setLoadState(treeRef.current ? 'stale' : 'error');
    }
  }, []);

  const cleanView = draft === null && areaCityId === null && pendingArea === null && !placeBusy;
  useEntityRefresh(load, { contextKey: 'admin-geography', enabled: cleanView, intervalMs: null });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadGenerationRef.current += 1;
      requestGenerationRef.current += 1;
      areaCityIdRef.current = null;
    };
  }, []);

  const isCurrentAreaRequest = useCallback((request: AreaRequest) =>
    mountedRef.current
    && request.requestGeneration === requestGenerationRef.current
    && request.cityId === areaCityIdRef.current
    && request.query === areaQueryRef.current
    && request.sessionToken === sessionRef.current, []);

  const isCurrentPendingArea = useCallback((area: PendingArea | null, cityId: string) =>
    area !== null
    && area.cityId === cityId
    && area.cityId === areaCityIdRef.current
    && area.query === areaQueryRef.current
    && area.requestGeneration === requestGenerationRef.current
    && Boolean(area.sessionToken), []);

  const isCurrentSearch = useCallback((search: PlaceSearch | null, cityId: string) =>
    search !== null
    && search.cityId === cityId
    && isCurrentAreaRequest(search), [isCurrentAreaRequest]);

  const addNode = async () => {
    if (!draft?.name.trim()) return;
    const key = `new:${draft.kind}:${draft.parentId ?? 'root'}`;
    setSaving(key);
    try {
      await upsertGeo({ kind: draft.kind, parentId: draft.parentId, name: draft.name.trim(), active: true });
      setDraft(null);
      await load();
    } catch (cause) {
      toast({ message: cause instanceof Error ? cause.message : String(cause), tone: 'error' });
    } finally {
      setSaving(null);
    }
  };

  const toggleNode = async (
    kind: GeoKind,
    id: string,
    parentId: string | null,
    name: string,
    lat: number | null,
    lng: number | null,
    active: boolean,
  ) => {
    setSaving(id);
    try {
      await upsertGeo({ kind, id, parentId, name, lat, lng, active });
      await load();
    } catch (cause) {
      toast({ message: cause instanceof Error ? cause.message : String(cause), tone: 'error' });
    } finally {
      setSaving(null);
    }
  };

  const startAreaEntry = (cityId: string) => {
    const nextCityId = areaCityIdRef.current === cityId ? null : cityId;
    requestGenerationRef.current += 1;
    areaCityIdRef.current = nextCityId;
    areaQueryRef.current = '';
    sessionRef.current = newPlacesSession();
    setAreaCityId(nextCityId);
    setAreaQuery('');
    setPlaceResults(null);
    setPlaceBusy(false);
    setAreaError(null);
    setPendingArea(null);
  };

  const changeAreaQuery = (query: string) => {
    if (query === areaQueryRef.current) return;
    requestGenerationRef.current += 1;
    areaQueryRef.current = query;
    setAreaQuery(query);
    setPlaceResults(null);
    setPlaceBusy(false);
    setAreaError(null);
    setPendingArea(null);
  };

  const searchArea = async (cityId: string, cityName: string) => {
    const query = areaQueryRef.current;
    if (areaCityIdRef.current !== cityId || query.trim().length < 3) return;
    const request: AreaRequest = {
      cityId,
      query,
      sessionToken: sessionRef.current,
      requestGeneration: ++requestGenerationRef.current,
    };
    setPlaceBusy(true);
    setAreaError(null);
    setPlaceResults(null);
    setPendingArea(null);
    try {
      const results = await searchPlaces(query, cityName, { sessionToken: request.sessionToken });
      if (isCurrentAreaRequest(request)) setPlaceResults({ ...request, results });
    } catch (cause) {
      if (isCurrentAreaRequest(request)) setAreaError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (isCurrentAreaRequest(request)) setPlaceBusy(false);
    }
  };

  const pickPlace = async (result: PlaceResult, search: PlaceSearch) => {
    if (!isCurrentSearch(search, search.cityId) || !search.results.includes(result)) return;
    const request: AreaRequest = { ...search, requestGeneration: ++requestGenerationRef.current };
    setPlaceBusy(true);
    setAreaError(null);
    setPlaceResults(null);
    setPendingArea(null);
    let completed = false;
    try {
      const location = await resolvePlace(result, request.sessionToken);
      if (!isCurrentAreaRequest(request)) return;
      sessionRef.current = newPlacesSession();
      setPendingArea({
        ...request,
        name: location.area,
        lat: location.lat,
        lng: location.lng,
      });
      setPlaceBusy(false);
      completed = true;
    } catch (cause) {
      if (isCurrentAreaRequest(request)) setAreaError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!completed && isCurrentAreaRequest(request)) setPlaceBusy(false);
    }
  };

  const updatePendingAreaName = (cityId: string, area: PendingArea, name: string) => {
    setPendingArea((current) =>
      isCurrentPendingArea(current, cityId) && current?.requestGeneration === area.requestGeneration
        ? { ...current, name }
        : current,
    );
  };

  const addArea = async (cityId: string, area: PendingArea) => {
    if (!area.name.trim() || !isCurrentPendingArea(area, cityId)) return;
    const key = `new:area:${area.cityId}`;
    setSaving(key);
    try {
      await upsertGeo({
        kind: 'area',
        parentId: area.cityId,
        name: area.name.trim(),
        lat: area.lat,
        lng: area.lng,
        active: true,
      });
      if (isCurrentPendingArea(area, cityId)) {
        requestGenerationRef.current += 1;
        areaCityIdRef.current = null;
        areaQueryRef.current = '';
        sessionRef.current = newPlacesSession();
        setAreaCityId(null);
        setAreaQuery('');
        setPlaceResults(null);
        setPlaceBusy(false);
        setAreaError(null);
        setPendingArea(null);
      }
      await load();
      toast({ message: 'Area added', tone: 'success' });
    } catch (cause) {
      if (isCurrentPendingArea(area, cityId)) {
        setAreaError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      setSaving((current) => current === key ? null : current);
    }
  };

  const renderDraft = (kind: Draft['kind'], parentId: string | null) => {
    if (!draft || draft.kind !== kind || draft.parentId !== parentId) return null;
    const key = `new:${kind}:${parentId ?? 'root'}`;
    return (
      <View style={{ gap: t.spacing.sm, marginTop: t.spacing.sm }}>
        <Input
          label={`New ${kind}`}
          value={draft.name}
          onChangeText={(name) => setDraft((current) => current ? { ...current, name } : current)}
          maxLength={80}
        />
        <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
          <Button title="Save" onPress={() => void addNode()} loading={saving === key} disabled={!draft.name.trim()} />
          <Button title="Cancel" variant="ghost" onPress={() => setDraft(null)} />
        </View>
      </View>
    );
  };

  return {
    t,
    tree,
    loadState,
    error,
    draft,
    setDraft,
    saving,
    areaCityId,
    areaQuery,
    placeResults,
    placeBusy,
    areaError,
    pendingArea,
    load,
    addNode,
    toggleNode,
    startAreaEntry,
    changeAreaQuery,
    searchArea,
    pickPlace,
    addArea,
    updatePendingAreaName,
    isCurrentSearch,
    isCurrentPendingArea,
    renderDraft,
  };
}

function ToggleRow(props: { title: string; active: boolean; disabled: boolean; onChange: (active: boolean) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
      <View style={{ flex: 1 }}>
        <Text variant="calloutStrong">{props.title}</Text>
        <Text variant="caption" color="muted">{props.active ? 'Active' : 'Inactive'}</Text>
      </View>
      <Switch value={props.active} disabled={props.disabled} onValueChange={props.onChange} />
    </View>
  );
}
