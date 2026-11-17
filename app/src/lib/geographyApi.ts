import { supabase } from './supabase';
import type { ManagedArea } from './locationModel';

export type GeoKind = 'state' | 'district' | 'city' | 'area';

export interface GeoState {
  id: string;
  name: string;
  active: boolean;
}

export interface GeoDistrict {
  id: string;
  state_id: string;
  name: string;
  active: boolean;
}

export interface GeoCity {
  id: string;
  district_id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  active: boolean;
}

export interface GeoArea {
  id: string;
  city_id: string;
  name: string;
  lat: number;
  lng: number;
  active: boolean;
  sort_order: number;
}

export interface GeographyTree {
  states: GeoState[];
  districts: GeoDistrict[];
  cities: GeoCity[];
  areas: GeoArea[];
}

export interface UpsertGeoInput {
  kind: GeoKind;
  id?: string | null;
  parentId: string | null;
  name: string;
  lat?: number | null;
  lng?: number | null;
  active: boolean;
}

interface TableRows {
  states: GeoState[];
  districts: GeoDistrict[];
  cities: GeoCity[];
  areas: GeoArea[];
}

function unwrapRows<T>(result: { data: unknown; error: { message: string } | null }): T[] {
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as T[];
}

async function loadRows(includeInactive: boolean): Promise<TableRows> {
  const [statesResult, districtsResult, citiesResult, areasResult] = await Promise.all([
    supabase.from('geo_states').select('id,name,active').order('name'),
    supabase.from('geo_districts').select('id,state_id,name,active').order('name'),
    supabase.from('geo_cities').select('id,district_id,name,lat,lng,active').order('name'),
    supabase.from('geo_areas').select('id,city_id,name,lat,lng,active,sort_order').order('sort_order').order('name'),
  ]);
  const states = unwrapRows<GeoState>(statesResult);
  const districts = unwrapRows<GeoDistrict>(districtsResult);
  const cities = unwrapRows<GeoCity>(citiesResult);
  const areas = unwrapRows<GeoArea>(areasResult);
  if (includeInactive) return { states, districts, cities, areas };

  const stateIds = new Set(states.filter((row) => row.active).map((row) => row.id));
  const activeDistricts = districts.filter((row) => row.active && stateIds.has(row.state_id));
  const districtIds = new Set(activeDistricts.map((row) => row.id));
  const activeCities = cities.filter((row) => row.active && districtIds.has(row.district_id));
  const cityIds = new Set(activeCities.map((row) => row.id));
  return {
    states: states.filter((row) => row.active),
    districts: activeDistricts,
    cities: activeCities,
    areas: areas.filter((row) => row.active && cityIds.has(row.city_id)),
  };
}

/** Returns areas only when the area, city, district, and state are all active. */
export async function listAreas(): Promise<ManagedArea[]> {
  const rows = await loadRows(false);
  const cityNames = new Map(rows.cities.map((city) => [city.id, city.name]));
  return rows.areas.flatMap((area) => {
    const city = cityNames.get(area.city_id);
    return city ? [{ id: area.id, name: area.name, city, lat: Number(area.lat), lng: Number(area.lng), sort_order: area.sort_order }] : [];
  });
}

/** Admin reads use RLS's authenticated-admin policy to include inactive rows. */
export async function listGeography(): Promise<GeographyTree> {
  const rows = await loadRows(true);
  return {
    states: rows.states,
    districts: rows.districts,
    cities: rows.cities,
    areas: rows.areas.map((area) => ({ ...area, lat: Number(area.lat), lng: Number(area.lng) })),
  };
}

export async function isAreaPickerEnabled(): Promise<boolean> {
  const { data, error } = await supabase.rpc('get_app_features');
  if (error) throw new Error(error.message);
  return Boolean((data as Record<string, unknown> | null)?.area_picker);
}

export async function upsertGeo(input: UpsertGeoInput): Promise<string> {
  const { data, error } = await supabase.rpc('admin_upsert_geo', {
    p_kind: input.kind,
    p_id: input.id ?? null,
    p_parent_id: input.parentId,
    p_name: input.name,
    p_lat: input.lat ?? null,
    p_lng: input.lng ?? null,
    p_active: input.active,
  });
  if (error) throw new Error(error.message);
  return data as string;
}
