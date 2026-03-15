<script lang="ts">
  import { onMount } from 'svelte';
  import type { Driver, Session, Position } from '$lib/api';
  import { getDrivers, getSessions, getPositions, uniqueDrivers } from '$lib/api';
  import { getTeamColor, getTeamLogo } from '$lib/colors';

  const POINTS_MAP: Record<number, number> = {
    1: 25, 2: 18, 3: 15, 4: 12, 5: 10,
    6: 8, 7: 6, 8: 4, 9: 2, 10: 1,
  };

  const TEAM_ABBREVS: Record<string, string> = {
    'Mercedes': 'MER',
    'Red Bull Racing': 'RBR',
    'Ferrari': 'FER',
    'McLaren': 'MCL',
    'Aston Martin': 'AMR',
    'Alpine': 'ALP',
    'Williams': 'WIL',
    'Haas F1 Team': 'HAA',
    'Racing Bulls': 'RBU',
    'Kick Sauber': 'SAU',
    'Cadillac': 'CAD',
  };

  type Tab = 'drivers' | 'constructors';
  type SortMode = 'championship' | 'team' | 'name';

  let drivers = $state<Driver[]>([]);
  let driverPoints = $state<Map<number, number>>(new Map());
  let loading = $state(true);
  let revalidating = $state(false);
  let activeTab = $state<Tab>('drivers');
  let sortMode = $state<SortMode>('championship');

  // --- SWR Cache helpers ---
  const DRIVERS_CACHE_KEY = 'pitwall_drivers_2026';
  const DRIVERS_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours

  interface CacheEntry<T> {
    data: T;
    timestamp: number;
  }

  function cacheGet<T>(key: string, ttl: number): T | null {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const entry: CacheEntry<T> = JSON.parse(raw);
      if (Date.now() - entry.timestamp > ttl) return null;
      return entry.data;
    } catch {
      return null;
    }
  }

  function cacheSet<T>(key: string, data: T): void {
    try {
      const entry: CacheEntry<T> = { data, timestamp: Date.now() };
      localStorage.setItem(key, JSON.stringify(entry));
    } catch {
      // localStorage full or unavailable
    }
  }

  interface ChampionshipCache {
    drivers: Driver[];
    points: [number, number][];
  }

  function getTeamAbbrev(teamName: string): string {
    for (const [key, abbrev] of Object.entries(TEAM_ABBREVS)) {
      if (teamName?.toLowerCase().includes(key.toLowerCase())) return abbrev;
    }
    return teamName?.slice(0, 3).toUpperCase() ?? '???';
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

  interface ConstructorStanding {
    teamName: string;
    color: string;
    totalPoints: number;
    drivers: { name: string; acronym: string; points: number; headshot_url: string }[];
  }

  let constructorStandings = $derived.by(() => {
    const teamMap = new Map<string, ConstructorStanding>();
    for (const driver of drivers) {
      const color = getTeamColor(driver.team_name, driver.team_colour);
      const pts = driverPoints.get(driver.driver_number) ?? 0;
      if (!teamMap.has(driver.team_name)) {
        teamMap.set(driver.team_name, {
          teamName: driver.team_name,
          color,
          totalPoints: 0,
          drivers: [],
        });
      }
      const team = teamMap.get(driver.team_name)!;
      team.totalPoints += pts;
      team.drivers.push({ name: driver.full_name, acronym: driver.name_acronym, points: pts, headshot_url: driver.headshot_url ?? '' });
    }
    return [...teamMap.values()].sort((a, b) => b.totalPoints - a.totalPoints);
  });

  async function fetchChampionshipData(): Promise<ChampionshipCache | null> {
    const sessions = await getSessions({ year: 2026, session_type: 'Race' });
    const now = new Date();
    const pastRaces = sessions.filter(s => new Date(s.date_start) <= now);
    const sorted = pastRaces.sort((a, b) => new Date(b.date_start).getTime() - new Date(a.date_start).getTime());
    const latest = sorted[0] ?? sessions.sort((a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime())[0];
    if (!latest) return null;

    const raw = await getDrivers(latest.session_key);
    const drvs = uniqueDrivers(raw);

    const points = new Map<number, number>();
    const positionPromises = pastRaces.map(s => getPositions(s.session_key));
    const allPositions = await Promise.all(positionPromises);

    for (const racePositions of allPositions) {
      const finalPositions = new Map<number, number>();
      for (const p of racePositions) {
        finalPositions.set(p.driver_number, p.position);
      }
      for (const [driverNum, pos] of finalPositions) {
        const pts = POINTS_MAP[pos] ?? 0;
        points.set(driverNum, (points.get(driverNum) ?? 0) + pts);
      }
    }

    return { drivers: drvs, points: [...points.entries()] };
  }

  function applyCachedData(cached: ChampionshipCache) {
    drivers = cached.drivers;
    driverPoints = new Map(cached.points);
  }

  onMount(async () => {
    // SWR: try cached data first
    const cached = cacheGet<ChampionshipCache>(DRIVERS_CACHE_KEY, DRIVERS_CACHE_TTL);
    if (cached) {
      applyCachedData(cached);
      loading = false;

      // Background revalidate
      revalidating = true;
      try {
        const fresh = await fetchChampionshipData();
        if (fresh) {
          cacheSet(DRIVERS_CACHE_KEY, fresh);
          applyCachedData(fresh);
        }
      } catch (e) {
        console.error('Background revalidation failed:', e);
      } finally {
        revalidating = false;
      }
    } else {
      try {
        const data = await fetchChampionshipData();
        if (data) {
          cacheSet(DRIVERS_CACHE_KEY, data);
          applyCachedData(data);
        }
      } catch (e) {
        console.error(e);
      } finally {
        loading = false;
      }
    }
  });
</script>

<div class="max-w-7xl mx-auto px-4 py-6">
  <div class="flex items-center gap-3 mb-4">
    <div class="w-1 h-5 bg-pit-accent"></div>
    <h1 class="heading-f1 text-xl text-pit-text">2026 Championship Standings</h1>
    <div class="flex-1 h-px bg-pit-border"></div>
    {#if revalidating}
      <span class="w-2 h-2 rounded-full bg-pit-accent animate-spin-slow opacity-70" title="Refreshing data"></span>
    {/if}
    <span class="text-[10px] uppercase tracking-widest text-pit-text-muted data-mono">
      {activeTab === 'drivers' ? `${drivers.length} Drivers` : `${constructorStandings.length} Teams`}
    </span>
  </div>

  <!-- Tab toggle -->
  <div class="flex items-center gap-0 mb-6 border-b border-pit-border">
    {#each [['drivers', 'Drivers Standings'], ['constructors', 'Constructors Standings']] as [tab, label]}
      <button
        class="px-5 py-2.5 text-[11px] uppercase tracking-widest font-bold transition-all duration-150 border-b-2 -mb-px {activeTab === tab ? 'text-pit-accent border-pit-accent' : 'text-pit-text-muted border-transparent hover:text-pit-text-dim'}"
        onclick={() => activeTab = tab as Tab}
      >
        {label}
      </button>
    {/each}
  </div>

  {#if loading}
    <!-- Skeleton loading -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-pit-border">
      {#each Array(12) as _}
        <div class="bg-pit-bg p-5 relative flex flex-col h-full">
          <div class="absolute left-0 top-0 bottom-0 w-[2px] bg-pit-surface animate-pulse"></div>
          <div class="flex items-center gap-3 mb-3">
            <div class="w-10 h-10 rounded-full bg-pit-surface animate-pulse"></div>
            <div class="flex-1 min-w-0">
              <div class="h-5 w-12 bg-pit-surface animate-pulse rounded-sm mb-1"></div>
              <div class="h-3 w-24 bg-pit-surface animate-pulse rounded-sm"></div>
            </div>
            <div class="w-10 h-10 bg-pit-surface animate-pulse"></div>
          </div>
          <div class="flex items-center gap-2 mb-3">
            <div class="h-8 w-16 bg-pit-surface animate-pulse rounded-sm"></div>
            <div class="h-3 w-20 bg-pit-surface animate-pulse rounded-sm"></div>
          </div>
          <div class="flex items-center justify-between border-t border-pit-border pt-2 mt-auto">
            <div class="h-3 w-10 bg-pit-surface animate-pulse rounded-sm"></div>
            <div class="h-4 w-8 bg-pit-surface animate-pulse rounded-sm"></div>
          </div>
        </div>
      {/each}
    </div>
  {:else if activeTab === 'drivers'}
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

    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-pit-border">
      {#each sortedDrivers as driver, i}
        {@const color = getTeamColor(driver.team_name, driver.team_colour)}
        {@const pts = driverPoints.get(driver.driver_number) ?? 0}
        <div class="bg-pit-bg p-5 hover:bg-pit-surface transition-all duration-150 group relative flex flex-col h-full">
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
            <img
              src={getTeamLogo(driver.team_name)}
              class="h-8 w-auto"
              alt={driver.team_name}
              onerror={(e) => { const el = e.currentTarget as HTMLImageElement; const d = document.createElement('div'); d.className = 'w-8 h-8 rounded-full flex items-center justify-center shrink-0'; d.style.backgroundColor = color; d.innerHTML = `<span class="text-[9px] font-bold text-white leading-none">${getTeamAbbrev(driver.team_name)}</span>`; el.replaceWith(d); }}
            />
            <span class="text-[10px] text-pit-text-muted uppercase tracking-wider truncate">{driver.team_name}</span>
          </div>

          <!-- Points -->
          <div class="flex items-center justify-between border-t border-pit-border pt-2 mt-auto">
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
  {:else}
    <!-- Constructors standings -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-pit-border">
      {#each constructorStandings as team, i}
        <div class="bg-pit-bg p-5 hover:bg-pit-surface transition-all duration-150 relative flex flex-col h-full">
          <!-- Team color accent -->
          <div class="absolute left-0 top-0 bottom-0 w-[2px]" style="background-color: {team.color}"></div>

          <!-- Team header -->
          <div class="flex items-center gap-3 mb-4">
            <div
              class="w-10 h-10 rounded-full flex items-center justify-center shrink-0 border-2"
              style="background-color: {team.color}33; border-color: {team.color}99"
            >
              <img
                src={getTeamLogo(team.teamName)}
                class="w-6 h-6 object-contain"
                alt={team.teamName}
                onerror={(e) => { const el = e.currentTarget as HTMLImageElement; const d = document.createElement('span'); d.className = 'text-[9px] font-bold text-white leading-none'; d.textContent = getTeamAbbrev(team.teamName); el.replaceWith(d); }}
              />
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="heading-f1 text-base text-pit-text leading-none truncate">{team.teamName}</h3>
            </div>
            <span class="text-[10px] text-pit-text-muted data-mono">C{i + 1}</span>
          </div>

          <!-- Total points -->
          <div class="flex items-center justify-between mb-4">
            <span class="text-[10px] text-pit-text-dim uppercase tracking-wider">Total Points</span>
            <span class="text-lg font-bold data-mono" style="color: {team.totalPoints > 0 ? team.color : ''}">{team.totalPoints}</span>
          </div>

          <!-- Drivers -->
          <div class="border-t border-pit-border pt-3 flex flex-col gap-2">
            {#each team.drivers as d}
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  {#if d.headshot_url}
                    <img src={d.headshot_url} alt={d.name} class="w-7 h-7 rounded-full object-cover bg-pit-surface" />
                  {:else}
                    <div class="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0" style="background-color: {team.color}">
                      {d.acronym.slice(0,2)}
                    </div>
                  {/if}
                  <span class="heading-f1 text-sm text-pit-text">{d.acronym}</span>
                  <span class="text-[10px] text-pit-text-dim truncate">{d.name}</span>
                </div>
                <span class="text-xs font-bold text-pit-text-dim data-mono">{d.points}</span>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  @keyframes spin-slow {
    to { transform: rotate(360deg); }
  }
  .animate-spin-slow {
    animation: spin-slow 1.5s linear infinite;
  }
</style>
