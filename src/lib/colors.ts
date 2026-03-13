// F1 team colors for 2026 season
export const TEAM_COLORS: Record<string, string> = {
  'Red Bull Racing': '#3671C6',
  'Ferrari': '#E8002D',
  'McLaren': '#FF8000',
  'Mercedes': '#27F4D2',
  'Aston Martin': '#229971',
  'Alpine': '#FF87BC',
  'Williams': '#64C4FF',
  'RB': '#6692FF',
  'Kick Sauber': '#52E252',
  'Haas F1 Team': '#B6BABD',
};

// Tyre compound colors
export const TYRE_COLORS: Record<string, string> = {
  SOFT: '#FF3333',
  MEDIUM: '#FFC800',
  HARD: '#CCCCCC',
  INTERMEDIATE: '#39B54A',
  WET: '#0072C6',
  UNKNOWN: '#888888',
};

export function getTeamColor(teamName: string, fallbackHex?: string): string {
  if (fallbackHex && fallbackHex !== '000000') return `#${fallbackHex}`;
  for (const [key, color] of Object.entries(TEAM_COLORS)) {
    if (teamName?.toLowerCase().includes(key.toLowerCase())) return color;
  }
  return '#888888';
}
