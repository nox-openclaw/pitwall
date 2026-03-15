const IS_SERVER = typeof window === "undefined";

const BASE = IS_SERVER
  ? "https://openf1-api.sliplane.app/v1"
  : "/api/openf1";

async function fetchApi<T>(endpoint: string, params?: Record<string, string | number>): Promise<T> {
  const url = new URL(
    IS_SERVER ? `${BASE}${endpoint}` : `${BASE}${endpoint}`,
    IS_SERVER ? undefined : window.location.origin
  );

  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined) url.searchParams.set(k, String(v));
    });
  }

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<T>;
}

export interface Session {
  session_key: number;
  session_type: string;
  session_name: string;
  date_start: string;
  date_end: string;
  meeting_key: number;
  circuit_key: number;
  circuit_short_name: string;
  country_key: number;
  country_code: string;
  country_name: string;
  location: string;
  gmt_offset: string;
  year: number;
}

export interface Driver {
  driver_number: number;
  broadcast_name: string;
  full_name: string;
  name_acronym: string;
  team_name: string;
  team_colour: string;
  first_name: string;
  last_name: string;
  headshot_url: string;
  country_code: string;
  session_key: number;
  meeting_key: number;
}

export interface Lap {
  session_key: number;
  driver_number: number;
  lap_number: number;
  lap_duration: number | null;
  i1_speed: number | null;
  i2_speed: number | null;
  st_speed: number | null;
  date_start: string;
  is_pit_out_lap: boolean;
  duration_sector_1: number | null;
  duration_sector_2: number | null;
  duration_sector_3: number | null;
}

export interface Stint {
  session_key: number;
  driver_number: number;
  stint_number: number;
  lap_start: number;
  lap_end: number;
  compound: string;
  tyre_age_at_start: number;
}

export interface Position {
  session_key: number;
  driver_number: number;
  date: string;
  position: number;
  meeting_key: number;
}

export function getSessions(params?: Record<string, string | number>): Promise<Session[]> {
  return fetchApi<Session[]>("/sessions", params);
}

export function getDrivers(sessionKey: number): Promise<Driver[]> {
  return fetchApi<Driver[]>("/drivers", { session_key: sessionKey });
}

export function getLaps(sessionKey: number, params?: Record<string, string | number>): Promise<Lap[]> {
  return fetchApi<Lap[]>("/laps", { session_key: sessionKey, ...params });
}

export function getStints(sessionKey: number): Promise<Stint[]> {
  return fetchApi<Stint[]>("/stints", { session_key: sessionKey });
}

export function getPositions(sessionKey: number): Promise<Position[]> {
  return fetchApi<Position[]>("/position", { session_key: sessionKey });
}

export function uniqueDrivers(drivers: Driver[]): Driver[] {
  const map = new Map<number, Driver>();
  for (const d of drivers) {
    map.set(d.driver_number, d);
  }
  return Array.from(map.values());
}
