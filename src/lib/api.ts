const BASE = 'https://api.openf1.org/v1';

async function fetchApi<T>(endpoint: string, params?: Record<string, string | number>): Promise<T> {
  const url = new URL(`${BASE}${endpoint}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export interface Session {
  session_key: number;
  session_name: string;
  session_type: string;
  date_start: string;
  date_end: string;
  circuit_short_name: string;
  country_name: string;
  country_code: string;
  location: string;
  year: number;
}

export interface Driver {
  driver_number: number;
  broadcast_name: string;
  full_name: string;
  name_acronym: string;
  team_name: string;
  team_colour: string;
  headshot_url: string;
  country_code: string;
  session_key: number;
}

export interface Lap {
  driver_number: number;
  lap_number: number;
  lap_duration: number | null;
  is_pit_out_lap: boolean;
  st_speed: number | null;
  sector_1_duration: number | null;
  sector_2_duration: number | null;
  sector_3_duration: number | null;
  segments_sector_1?: number[];
  segments_sector_2?: number[];
  segments_sector_3?: number[];
  date_start: string;
}

export interface Stint {
  driver_number: number;
  stint_number: number;
  compound: string;
  tyre_age_at_start: number;
  lap_start: number;
  lap_end: number;
}

export interface Position {
  driver_number: number;
  position: number;
  date: string;
}

export async function getSessions(params?: Record<string, string | number>): Promise<Session[]> {
  return fetchApi<Session[]>('/sessions', params);
}

export async function getDrivers(sessionKey: number): Promise<Driver[]> {
  return fetchApi<Driver[]>('/drivers', { session_key: sessionKey });
}

export async function getLaps(sessionKey: number, driverNumber?: number): Promise<Lap[]> {
  const params: Record<string, string | number> = { session_key: sessionKey };
  if (driverNumber) params.driver_number = driverNumber;
  return fetchApi<Lap[]>('/laps', params);
}

export async function getStints(sessionKey: number): Promise<Stint[]> {
  return fetchApi<Stint[]>('/stints', { session_key: sessionKey });
}

export async function getPositions(sessionKey: number): Promise<Position[]> {
  return fetchApi<Position[]>('/position', { session_key: sessionKey });
}

// Deduplicate drivers by driver_number (API can return multiples)
export function uniqueDrivers(drivers: Driver[]): Driver[] {
  const map = new Map<number, Driver>();
  for (const d of drivers) {
    map.set(d.driver_number, d);
  }
  return Array.from(map.values());
}
