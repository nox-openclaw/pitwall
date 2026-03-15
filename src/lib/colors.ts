// F1 team colors — 2026 season
export const TEAM_COLORS: Record<string, string> = {
  'Red Bull Racing': '#3671C6',
  'Ferrari': '#E80020',
  'McLaren': '#FF8000',
  'Mercedes': '#27F4D2',
  'Aston Martin': '#229971',
  'Alpine': '#0093CC',
  'Williams': '#1868DB',
  'Racing Bulls': '#6692FF',
  'Cadillac': '#FFD700',
  'Haas F1 Team': '#B6BABD',
};

// Tyre compound colors
export const TYRE_COLORS: Record<string, string> = {
  SOFT: '#E8002D',
  MEDIUM: '#FFC800',
  HARD: '#CCCCCC',
  INTERMEDIATE: '#39B54A',
  WET: '#0072C6',
  UNKNOWN: '#555555',
};

const TEAM_LOGO_MAP: Record<string, string> = {
  'Mercedes': 'mercedes',
  'Red Bull Racing': 'redbullracing',
  'Ferrari': 'ferrari',
  'McLaren': 'mclaren',
  'Aston Martin': 'astonmartin',
  'Alpine': 'alpine',
  'Williams': 'williams',
  'Haas F1 Team': 'haasf1team',
  'RB F1 Team': 'racingbulls',
  'Racing Bulls': 'racingbulls',
  'Kick Sauber': 'audi',
  'Cadillac': 'cadillac',
};

export function getTeamLogo(teamName: string): string {
  for (const [key, file] of Object.entries(TEAM_LOGO_MAP)) {
    if (teamName?.toLowerCase().includes(key.toLowerCase())) return `/logos/${file}.webp`;
  }
  return `/logos/${teamName?.toLowerCase().replace(/\s+/g, '')}.webp`;
}

export function getTeamColor(teamName: string, fallbackHex?: string): string {
  if (fallbackHex && fallbackHex !== '000000') return `#${fallbackHex}`;
  for (const [key, color] of Object.entries(TEAM_COLORS)) {
    if (teamName?.toLowerCase().includes(key.toLowerCase())) return color;
  }
  return '#888888';
}
