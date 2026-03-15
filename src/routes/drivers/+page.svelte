<script lang="ts">
  import { onMount } from 'svelte';
  import type { Driver, Session, Position } from '$lib/api';
  import { getDrivers, getSessions, getPositions, uniqueDrivers } from '$lib/api';
  import { getTeamColor } from '$lib/colors';

  const POINTS_MAP: Record<number, number> = {
    1: 25, 2: 18, 3: 15, 4: 12, 5: 10,
    6: 8, 7: 6, 8: 4, 9: 2, 10: 1,
  };

  const TEAM_LOGO_SLUGS: Record<string, string> = {
    'Mercedes': 'mercedes',
    'Red Bull Racing': 'red-bull',
    'Ferrari': 'ferrari',
    'McLaren': 'mclaren',
    'Aston Martin': 'aston-martin',
    'Alpine': 'alpine',
    'Williams': 'williams',
    'Haas F1 Team': 'haas',
    'Racing Bulls': 'racing-bulls',
    'Kick Sauber': 'kick-sauber',
    'Cadillac': 'cadillac',
  };

  type SortMode = 'championship' | 'team' | 'name';

  let drivers = $state<Driver[]>([]);
  let driverPoints = $state<Map<number, number>>(new Map());
  let loading = $state(true);
  let sortMode = $state<SortMode>('championship');

  function getTeamLogoUrl(teamName: string): string | null {
    for (const [key, slug] of Object.entries(TEAM_LOGO_SLUGS)) {
      if (teamName?.toLowerCase().includes(key.toLowerCase())) {
        return `https://media.formula1.com/image/upload/f_auto,c_limit,q_75,w_112/content/dam/fom-website/teams/2026/${slug}.png`;
      }
    }
    return null;
  }

  function getInitials(name: string): string {
    return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  }

  let sortedDrivers = $derived.by(() => {
    const arr = [...drivers];
    switch (sortMode) {
      case 'championship':
        return arr.sort((a, b) => (driverPoints.get(b.driver_number) ?? 0) - (driverPoints.get(a.driver_number) ?? 0));
      case 'team':
        return arr.sort((a, b) => a.team_name.localeCompare(b.team_name));
      case 'name':
        return arr.sort((a, b) => a.full_name.localeCompare(b.full_name));
      default:
        return arr;
    }
  });

  onMount(async () => {
    try {
      const sessions = await getSessions({ year: 2026, session_type: 'Race' });
      const now = new Date();
      const pastRaces = sessions.filter(s => new Date(s.date_start) <= now);
      const sorted = pastRaces.sort((a, b) => new Date(b.date_start).getTime() - new Date(a.date_start).getTime());
      const latest = sorted[0] ?? sessions.sort((a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime())[0];
      if (!latest) return;

      // Fetch drivers from latest session
      const raw = await getDrivers(latest.session_key);
      drivers = uniqueDrivers(raw);

      // Fetch positions from all past race sessions to calculate championship points
      const points = new Map<number, number>();
      const positionPromises = pastRaces.map(s => getPositions(s.session_key));
      const allPositions = await Promise.all(positionPromises);

      for (const racePositions of allPositions) {
        // Get final position per driver (last position entry = final)
        const finalPositions = new Map<number, number>();
        for (const p of racePositions) {
          finalPositions.set(p.driver_number, p.position);
        }
        for (const [driverNum, pos] of finalPositions) {
          const pts = POINTS_MAP[pos] ?? 0;
          points.set(driverNum, (points.get(driverNum) ?? 0) + pts);
        }
      }
      driverPoints = points;
    } catch (e) {
      console.error(e);
    } finally {
      loading = false;
    }
  });
</script>

<div class="max-w-7xl mx-auto px-4 py-6">
  <div class="flex items-center gap-3 mb-4">
    <div class="w-1 h-5 bg-pit-accent"></div>
    <h1 class="heading-f1 text-xl text-pit-text">2026 Championship Standings</h1>
    <div class="flex-1 h-px bg-pit-border"></div>
    <span class="text-[10px] uppercase tracking-widest text-pit-text-muted data-mono">{drivers.length} Drivers</span>
  </div>

  <!-- Sort toggle -->
  <div class="flex items-center gap-1 mb-6">
    <span class="text-[10px] uppercase tracking-widest text-pit-text-dim mr-2">Sort</span>
    {#each [['championship', 'Championship'], ['team', 'Team'], ['name', 'Name']] as [mode, label]}
      <button
        class="px-3 py-1 text-[10px] uppercase tracking-wider font-medium transition-all duration-150 border {sortMode === mode ? 'bg-pit-accent text-white border-pit-accent' : 'bg-transparent text-pit-text-muted border-pit-border hover:border-pit-text-muted'}"
        onclick={() => sortMode = mode as SortMode}
      >
        {label}
      </button>
    {/each}
  </div>

  {#if loading}
    <div class="flex items-center justify-center py-20">
      <div class="w-7 h-7 spinner-f1"></div>
    </div>
  {:else}
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-pit-border">
      {#each sortedDrivers as driver, i}
        {@const color = getTeamColor(driver.team_name, driver.team_colour)}
        {@const pts = driverPoints.get(driver.driver_number) ?? 0}
        {@const teamLogo = getTeamLogoUrl(driver.team_name)}
        <div class="bg-pit-bg p-5 hover:bg-pit-surface transition-all duration-150 group relative">
          <!-- Team color accent -->
          <div class="absolute left-0 top-0 bottom-0 w-[2px]" style="background-color: {color}"></div>

          <div class="flex items-center gap-3 mb-3">
            <!-- Headshot or initials fallback -->
            {#if driver.headshot_url}
              <img
                src={driver.headshot_url}
                alt={driver.full_name}
                class="w-10 h-10 rounded-full object-cover bg-pit-surface"
              />
            {:else}
              <div
                class="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white"
                style="background-color: {color}"
              >
                {getInitials(driver.full_name)}
              </div>
            {/if}

            <div class="flex-1 min-w-0">
              <h3 class="heading-f1 text-lg text-pit-text leading-none">{driver.name_acronym}</h3>
              <p class="text-xs text-pit-text-dim truncate">{driver.full_name}</p>
            </div>

            <div
              class="w-10 h-10 flex items-center justify-center text-sm font-bold text-white data-mono shrink-0"
              style="background-color: {color}"
            >
              {driver.driver_number}
            </div>
          </div>

          <!-- Team row with logo -->
          <div class="flex items-center gap-2 mb-3">
            {#if teamLogo}
              <img src={teamLogo} alt={driver.team_name} class="w-6 h-6 object-contain" />
            {:else}
              <div class="w-2 h-2 rounded-sm shrink-0" style="background-color: {color}"></div>
            {/if}
            <span class="text-[10px] text-pit-text-muted uppercase tracking-wider">{driver.team_name}</span>
          </div>

          <!-- Points -->
          <div class="flex items-center justify-between border-t border-pit-border pt-2">
            <span class="text-[10px] text-pit-text-dim uppercase tracking-wider">Points</span>
            <div class="flex items-center gap-2">
              {#if sortMode === 'championship'}
                <span class="text-[10px] text-pit-text-muted data-mono">#{i + 1}</span>
              {/if}
              <span class="text-sm font-bold text-pit-text data-mono" style="color: {pts > 0 ? color : ''}">{pts}</span>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
