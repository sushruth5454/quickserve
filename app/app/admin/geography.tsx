import { useCallback, useEffect, useRef, useState } from 'react';
import { Switch, View } from 'react-native';
import { Button, Card, Header, InlineAlert, Input, ListItem, Screen, Skeleton, Text, useToast } from '../../src/components/ui';
import { resolvePlace, searchPlaces, type PlaceResult } from '../../src/lib/locationContext';
import { newPlacesSession } from '../../src/lib/places';
import { listGeography, upsertGeo, type GeoKind, type GeographyTree } from '../../src/lib/geographyApi';
import { useTheme } from '../../src/theme';

type Draft = { kind: 'state' | 'district' | 'city'; parentId: string | null; name: string };
type PendingArea = { name: string; lat: number; lng: number };

export default function AdminGeographyScreen() {
  const t = useTheme();
  const toast = useToast();
  const [tree, setTree] = useState<GeographyTree | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [areaCityId, setAreaCityId] = useState<string | null>(null);
  const [areaQuery, setAreaQuery] = useState('');
  const [placeResults, setPlaceResults] = useState<PlaceResult[]>([]);
  const [placeBusy, setPlaceBusy] = useState(false);
  const [areaError, setAreaError] = useState<string | null>(null);
  const [pendingArea, setPendingArea] = useState<PendingArea | null>(null);
  const sessionRef = useRef(newPlacesSession());

  const load = useCallback(async () => {
    setError(null);
    try {
      setTree(await listGeography());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const addNode = async () => {
    if (!draft?.name.trim()) return;
    setSaving(`new:${draft.kind}:${draft.parentId ?? 'root'}`);
    try {
      await upsertGeo({ kind: draft.kind, parentId: draft.parentId, name: draft.name.trim(), active: true });
      setDraft(null);
      await load();
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    } finally {
      setSaving(null);
    }
  };

  const toggleNode = async (kind: GeoKind, id: string, parentId: string | null, name: string, lat: number | null, lng: number | null, active: boolean) => {
    setSaving(id);
    try {
      await upsertGeo({ kind, id, parentId, name, lat, lng, active });
      await load();
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    } finally {
      setSaving(null);
    }
  };

  const startAreaEntry = (cityId: string) => {
    setAreaCityId((current) => (current === cityId ? null : cityId));
    setAreaQuery('');
    setPlaceResults([]);
    setAreaError(null);
    setPendingArea(null);
  };

  const searchArea = async (city: string) => {
    setPlaceBusy(true);
    setAreaError(null);
    try {
      setPlaceResults(await searchPlaces(areaQuery, city, { sessionToken: sessionRef.current }));
    } catch (e) {
      setAreaError((e as Error).message);
    } finally {
      setPlaceBusy(false);
    }
  };

  const pickPlace = async (result: PlaceResult) => {
    setPlaceBusy(true);
    setAreaError(null);
    try {
      const location = await resolvePlace(result, sessionRef.current);
      sessionRef.current = newPlacesSession();
      setPendingArea({ name: location.area, lat: location.lat, lng: location.lng });
      setPlaceResults([]);
    } catch (e) {
      setAreaError((e as Error).message);
    } finally {
      setPlaceBusy(false);
    }
  };

  const addArea = async (cityId: string) => {
    if (!pendingArea?.name.trim()) return;
    setSaving(`new:area:${cityId}`);
    try {
      await upsertGeo({
        kind: 'area',
        parentId: cityId,
        name: pendingArea.name.trim(),
        lat: pendingArea.lat,
        lng: pendingArea.lng,
        active: true,
      });
      setAreaCityId(null);
      setPendingArea(null);
      setAreaQuery('');
      await load();
      toast({ message: 'Area added', tone: 'success' });
    } catch (e) {
      setAreaError((e as Error).message);
    } finally {
      setSaving(null);
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

  return (
    <Screen header={<Header title="Geography" subtitle="States · districts · cities · areas" />}>
      {error ? <InlineAlert message={error} actionLabel="Retry" onAction={() => void load()} /> : null}
      {!tree ? (
        <Skeleton height={360} radius={t.radii.lg} />
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
                                  onChangeText={setAreaQuery}
                                  onSubmitEditing={() => void searchArea(city.name)}
                                  returnKeyType="search"
                                />
                                <Button
                                  title="Search places"
                                  variant="outline"
                                  onPress={() => void searchArea(city.name)}
                                  loading={placeBusy}
                                  disabled={areaQuery.trim().length < 3}
                                />
                                {areaError ? <InlineAlert message={areaError} /> : null}
                                {placeResults.map((result, index) => (
                                  <ListItem
                                    key={result.placeId ?? `${result.title}:${index}`}
                                    icon="location-outline"
                                    title={result.title}
                                    subtitle={result.subtitle}
                                    onPress={() => void pickPlace(result)}
                                  />
                                ))}
                                {pendingArea ? (
                                  <>
                                    <Input
                                      label="Area name"
                                      value={pendingArea.name}
                                      onChangeText={(name) => setPendingArea((current) => current ? { ...current, name } : current)}
                                      maxLength={80}
                                    />
                                    <Text variant="caption" color="muted">
                                      Coordinates: {pendingArea.lat.toFixed(5)}, {pendingArea.lng.toFixed(5)}
                                    </Text>
                                    <Button
                                      title="Save area"
                                      onPress={() => void addArea(city.id)}
                                      loading={saving === `new:area:${city.id}`}
                                      disabled={!pendingArea.name.trim()}
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
