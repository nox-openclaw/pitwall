<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import type { Session, Driver, Lap, Stint } from '$lib/api';
  import { getSessions, getDrivers, getLaps, getStints, uniqueDrivers } from '$lib/api';
  import { chartState } from '$lib/chartState.svelte';
  import LapTimeChart from '$lib/components/LapTimeChart.svelte';
  import GapChart from '$lib/components/GapChart.svelte';
  import StintChart from '$lib/components/StintChart.svelte';
  import PositionChart from '$lib/components/PositionChart.svelte';
  import DriverLegend from '$lib/components/DriverLegend.svelte';
  import LapRangeSelector from '$lib/components/LapRangeSelector.svelte';
  import LapTimeSummaryTable from '$lib/components/LapTimeSummaryTable.svelte';

  let sessionKey = $derived(Number($page.params.session_key));

  // Circuit short name → local image filename (without .png)
  const CIRCUIT_IMAGE: Record<string, string> = {
    'Austin': 'austin',
    'Baku': 'baku',
    'Melbourne': 'melbourne',
    'Sakhir': 'bahrain',
    'Bahrain': 'bahrain',
    'Jeddah': 'jeddah',
    'Suzuka': 'suzuka',
    'Shanghai': 'shanghai',
    'Miami': 'miami',
    'Imola': 'imola',
    'Monaco': 'monaco',
    'Barcelona': 'catalunya',
    'Catalunya': 'catalunya',
    'Montréal': 'montreal',
    'Montreal': 'montreal',
    'Spielberg': 'spielberg',
    'Silverstone': 'silverstone',
    'Budapest': 'budapest',
    'Zandvoort': 'zandvoort',
    'Monza': 'monza',
    'Singapore': 'singapore',
    'Mexico City': 'mexico_city',
    'São Paulo': 'interlagos',
    'Sao Paulo': 'interlagos',
    'Interlagos': 'interlagos',
    'Las Vegas': 'las_vegas',
    'Lusail': 'lusail',
    'Yas Island': 'yas_marina',
    'Yas Marina': 'yas_marina',
  };

  function circuitImageUrl(name: string): string {
    const mapped = CIRCUIT_IMAGE[name];
    if (!mapped) return '';
    return `/circuits/${mapped}.png`;
  }

  // --- Primary session state (from URL session_key) ---
  let session = $state<Session | null>(null);
  let drivers = $state<Driver[]>([]);
  let laps = $state<Lap[]>([]);
  let stints = $state<Stint[]>([]);
  let loading = $state(true);
  let error = $state('');
  let dataReady = $state(false);

  // --- Year selector state ---
  let availableYears = $state<number[]>([]);
  let yearSessions = $state<Map<number, Session>>(new Map());
  let selectedYear = $state<number>(0);
  let yearLoading = $state(false);

  // Data for the currently viewed year (may differ from primary session)
  let viewDrivers = $state<Driver[]>([]);
  let viewLaps = $state<Lap[]>([]);
  let viewStints = $state<Stint[]>([]);
  let viewSession = $state<Session | null>(null);

  // --- Comparison mode state ---
  let showComparison = $state(false);
  let comparisonLaps = $state<Lap[]>([]);
  let comparisonDrivers = $state<Driver[]>([]);
  let comparisonYear = $state<number>(0);

  let isLive = $derived(() => {
    if (!viewSession?.date_start) return false;
    const start = new Date(viewSession.date_start).getTime();
    const now = Date.now();
    const fourHours = 4 * 60 * 60 * 1000;
    return start <= now && (now - start) <= fourHours;
  });

  // Is the selected year's session upcoming (hasn't happened yet)?
  let isUpcoming = $derived(() => {
    if (!viewSession?.date_start) return false;
    return new Date(viewSession.date_start).getTime() > Date.now();
  });

  // The primary session year (from URL)
  let primaryYear = $derived(session?.year ?? 0);

  // Whether viewing a historical year (not the primary session's year)
  let isHistorical = $derived(selectedYear !== 0 && selectedYear !== primaryYear);

  // Can show comparison toggle: primary year has data AND a different year is selected with data
  let canCompare = $derived(
    isHistorical && laps.length > 0 && viewLaps.length > 0
  );

  onMount(async () => {
    chartState.reset();

    try {
      const [sessionsData, driversData, lapsData, stintsData] = await Promise.all([
        getSessions({ session_key: sessionKey }),
        getDrivers(sessionKey),
        getLaps(sessionKey),
        getStints(sessionKey),
      ]);

      session = sessionsData[0] ?? null;
      drivers = uniqueDrivers(driversData);
      laps = lapsData;
      stints = stintsData;

      // Initialize view data to primary session
      viewSession = session;
      viewDrivers = drivers;
      viewLaps = laps;
      viewStints = stints;
      selectedYear = session?.year ?? 0;
      dataReady = true;

      // Fetch available years for this circuit
      if (session?.circuit_short_name) {
        fetchAvailableYears(session.circuit_short_name, session.session_type);
      }
    } catch (e) {
      error = 'Failed to load race data. This session may not exist or the API may be unavailable.';
      console.error(e);
    } finally {
      loading = false;
    }
  });

  async function fetchAvailableYears(circuitName: string, sessionType: string) {
    try {
      // Fetch all sessions for this circuit across years
      const allSessions = await getSessions({
        circuit_short_name: circuitName,
        session_type: sessionType,
      });

      const yearMap = new Map<number, Session>();
      for (const s of allSessions) {
        // Keep one session per year (prefer the one closest to the primary)
        if (!yearMap.has(s.year)) {
          yearMap.set(s.year, s);
        }
      }

      yearSessions = yearMap;
      availableYears = [...yearMap.keys()].sort((a, b) => a - b);
    } catch (e) {
      console.error('Failed to fetch year data:', e);
    }
  }

  async function selectYear(year: number) {
    if (year === selectedYear) return;

    showComparison = false;
    comparisonLaps = [];
    comparisonDrivers = [];
    selectedYear = year;
    chartState.reset();
    chartState.clearPins();

    // If selecting the primary session year, restore original data
    if (year === primaryYear) {
      viewSession = session;
      viewDrivers = drivers;
      viewLaps = laps;
      viewStints = stints;
      return;
    }

    // Load data for the selected year
    const targetSession = yearSessions.get(year);
    if (!targetSession) return;

    yearLoading = true;
    try {
      const [driversData, lapsData, stintsData] = await Promise.all([
        getDrivers(targetSession.session_key),
        getLaps(targetSession.session_key),
        getStints(targetSession.session_key),
      ]);

      viewSession = targetSession;
      viewDrivers = uniqueDrivers(driversData);
      viewLaps = lapsData;
      viewStints = stintsData;
    } catch (e) {
      console.error('Failed to load year data:', e);
      // Fall back to primary
      viewSession = session;
      viewDrivers = drivers;
      viewLaps = laps;
      viewStints = stints;
      selectedYear = primaryYear;
    } finally {
      yearLoading = false;
    }
  }

  async function toggleComparison() {
    if (showComparison) {
      showComparison = false;
      comparisonLaps = [];
      comparisonDrivers = [];
      return;
    }

    // Load the primary year's data as comparison data
    comparisonYear = primaryYear;
    comparisonLaps = laps;
    comparisonDrivers = drivers;
    showComparison = true;
  }

  // Live polling: auto-refresh data every 10 seconds when session is active
  $effect(() => {
    if (!isLive() || !viewSession) return;
    // Only poll if viewing the primary session
    if (viewSession.session_key !== sessionKey) return;

    const interval = setInterval(async () => {
      try {
        const [lapsData, stintsData] = await Promise.all([
          getLaps(sessionKey),
          getStints(sessionKey),
        ]);
        laps = lapsData;
        stints = stintsData;
        // Update view data if still viewing primary
        if (selectedYear === primaryYear) {
          viewLaps = lapsData;
          viewStints = stintsData;
        }
      } catch (e) {
        console.error('Live polling error:', e);
      }
    }, 10_000);

    return () => clearInterval(interval);
  });

  let maxLap = $derived(viewLaps.length > 0 ? Math.max(...viewLaps.map(l => l.lap_number)) : 60);

  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }
</script>

<div class="max-w-7xl mx-auto px-4 py-6">
  <div class="mb-4">
    <a href="/" class="text-pit-text-muted text-[10px] uppercase tracking-widest hover:text-pit-accent transition-colors data-mono">&larr; Back to races</a>
  </div>

  {#if loading}
    <div class="flex items-center justify-center py-20 gap-3">
      <div class="w-7 h-7 spinner-f1"></div>
      <span class="text-pit-text-muted text-xs uppercase tracking-wider">Loading telemetry...</span>
    </div>
  {:else if error}
    <div class="text-center py-20">
      <p class="text-pit-text-dim text-sm">{error}</p>
      <a href="/" class="text-pit-accent text-xs mt-4 inline-block hover:underline uppercase tracking-wider">Back to calendar</a>
    </div>
  {:else if session}
    {@const heroImg = circuitImageUrl(session.circuit_short_name)}
    <!-- Hero circuit image -->
    {#if heroImg}
      <div class="relative w-full h-[300px] mb-8 overflow-hidden border border-pit-border bg-[#1a1a2e]">
        <img
          src={heroImg}
          alt=""
          class="absolute inset-0 w-full h-full object-contain p-8 opacity-70"
        />
        <div class="absolute inset-0 bg-gradient-to-t from-pit-bg via-pit-bg/40 to-transparent"></div>
        <div class="absolute bottom-0 left-0 right-0 p-6 z-10">
          <div class="flex items-center gap-3 mb-2">
            <div class="w-1 h-6 bg-pit-accent"></div>
            <span class="text-[10px] uppercase tracking-widest text-pit-accent font-semibold data-mono">{viewSession?.session_type ?? session.session_type}</span>
            <div class="flex-1"></div>
            {#if isLive()}
              <div class="flex items-center gap-1.5">
                <div class="w-2 h-2 rounded-full bg-pit-accent pulse-live"></div>
                <span class="text-[10px] text-pit-accent font-bold uppercase tracking-wider data-mono">LIVE</span>
              </div>
            {:else}
              <div class="flex items-center gap-1.5">
                <div class="w-1.5 h-1.5 rounded-full bg-pit-text-muted"></div>
                <span class="text-[10px] text-pit-text-muted font-semibold uppercase tracking-wider data-mono">FINAL</span>
              </div>
            {/if}
          </div>
          <h1 class="heading-f1 text-3xl sm:text-4xl text-pit-text mb-1">
            {session.country_name} Grand Prix
          </h1>
          <p class="text-xs text-pit-text-muted font-mono tracking-wide">
            {viewSession?.circuit_short_name ?? session.circuit_short_name} &middot; {formatDate(viewSession?.date_start ?? session.date_start)}
          </p>
        </div>
      </div>
    {:else}
      <!-- Fallback header without circuit image -->
      <div class="mb-8 border-b border-pit-border pb-6">
        <div class="flex items-center gap-3 mb-2">
          <div class="w-1 h-6 bg-pit-accent"></div>
          <span class="text-[10px] uppercase tracking-widest text-pit-accent font-semibold data-mono">{viewSession?.session_type ?? session.session_type}</span>
          <div class="flex-1"></div>
          {#if isLive()}
            <div class="flex items-center gap-1.5">
              <div class="w-2 h-2 rounded-full bg-pit-accent pulse-live"></div>
              <span class="text-[10px] text-pit-accent font-bold uppercase tracking-wider data-mono">LIVE</span>
            </div>
          {:else}
            <div class="flex items-center gap-1.5">
              <div class="w-1.5 h-1.5 rounded-full bg-pit-text-muted"></div>
              <span class="text-[10px] text-pit-text-muted font-semibold uppercase tracking-wider data-mono">FINAL</span>
            </div>
          {/if}
        </div>
        <h1 class="heading-f1 text-3xl sm:text-4xl text-pit-text mb-1">
          {session.country_name} Grand Prix
        </h1>
        <p class="text-xs text-pit-text-muted font-mono tracking-wide">
          {viewSession?.circuit_short_name ?? session.circuit_short_name} &middot; {formatDate(viewSession?.date_start ?? session.date_start)}
        </p>
      </div>
    {/if}

    <!-- Year selector tabs -->
    {#if availableYears.length > 1}
      <div class="flex items-center gap-0 mb-6 border-b border-pit-border">
        <div class="flex items-center gap-2 mr-4">
          <div class="w-0.5 h-3 bg-pit-accent"></div>
          <span class="text-[10px] heading-f1 text-pit-text-dim tracking-widest">Season</span>
        </div>
        {#each availableYears as year}
          <button
            class="px-5 py-2.5 text-[11px] uppercase tracking-widest font-bold border-b-2 -mb-px transition-colors cursor-pointer {selectedYear === year ? 'text-pit-accent border-pit-accent' : 'text-pit-text-muted border-transparent hover:text-pit-text-dim'}"
            onclick={() => selectYear(year)}
            disabled={yearLoading}
          >
            {year}
          </button>
        {/each}
        {#if yearLoading}
          <div class="ml-3 flex items-center gap-2">
            <div class="w-4 h-4 spinner-f1"></div>
            <span class="text-[9px] text-pit-text-muted uppercase tracking-wider">Loading...</span>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Upcoming banner -->
    {#if isHistorical && isUpcoming()}
      <div class="mb-6 bg-pit-surface border border-pit-accent/30 p-4 flex items-center gap-3">
        <div class="w-1 h-8 bg-pit-accent"></div>
        <div>
          <p class="text-[11px] font-bold uppercase tracking-widest text-pit-accent">Upcoming</p>
          <p class="text-[10px] text-pit-text-muted mt-0.5">
            {selectedYear} session hasn't happened yet — showing {primaryYear} historical data
          </p>
        </div>
      </div>
    {/if}

    <!-- Showing historical data banner -->
    {#if isHistorical && !isUpcoming()}
      <div class="mb-6 bg-pit-surface border border-pit-border p-4 flex items-center gap-3">
        <div class="w-1 h-8 bg-pit-blue"></div>
        <div>
          <p class="text-[11px] font-bold uppercase tracking-widest text-pit-blue">Historical</p>
          <p class="text-[10px] text-pit-text-muted mt-0.5">
            Showing {selectedYear} {viewSession?.circuit_short_name} data
          </p>
        </div>
      </div>
    {/if}

    <!-- Stats bar -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-pit-border mb-8">
      <div class="bg-pit-bg p-4">
        <p class="text-[10px] text-pit-text-muted uppercase tracking-widest mb-1">Drivers</p>
        <p class="text-2xl font-bold data-mono text-pit-text">{viewDrivers.length}</p>
      </div>
      <div class="bg-pit-bg p-4">
        <p class="text-[10px] text-pit-text-muted uppercase tracking-widest mb-1">Total Laps</p>
        <p class="text-2xl font-bold data-mono text-pit-text">{viewLaps.length > 0 ? Math.max(...viewLaps.map(l => l.lap_number)) : '-'}</p>
      </div>
      <div class="bg-pit-bg p-4">
        <p class="text-[10px] text-pit-text-muted uppercase tracking-widest mb-1">Pit Stops</p>
        <p class="text-2xl font-bold data-mono text-pit-text">{viewStints.length > 0 ? viewStints.filter(s => s.stint_number > 1).length : '-'}</p>
      </div>
      <div class="bg-pit-bg p-4">
        <p class="text-[10px] text-pit-text-muted uppercase tracking-widest mb-1">Session</p>
        <p class="text-2xl font-bold data-mono text-pit-text">{viewSession?.session_type ?? session.session_type}</p>
      </div>
    </div>

    {#if dataReady && !yearLoading}
      <!-- Driver legend (shared toggle for all charts) -->
      {#if viewDrivers.length > 0}
        <div class="mb-4">
          <DriverLegend drivers={viewDrivers} laps={viewLaps} />
        </div>
      {/if}

      <!-- Comparison mode toggle -->
      {#if canCompare}
        <div class="mb-4 flex items-center gap-3">
          <button
            class="flex items-center gap-2 px-3 py-1.5 text-[10px] uppercase tracking-widest font-bold border transition-colors cursor-pointer {showComparison ? 'bg-pit-accent/10 border-pit-accent text-pit-accent' : 'bg-pit-surface border-pit-border text-pit-text-muted hover:text-pit-text-dim'}"
            onclick={toggleComparison}
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            {showComparison ? 'Hide' : 'Show'} comparison
          </button>
          {#if showComparison}
            <span class="text-[9px] text-pit-text-muted font-mono">
              Fastest driver overlay: {selectedYear} vs {primaryYear}
            </span>
          {/if}
        </div>
      {/if}

      <!-- Pinned annotations summary -->
      {#if chartState.pinnedAnnotations.length > 0}
        <div class="mb-4 bg-pit-surface border border-pit-border p-3">
          <div class="flex items-center gap-2 mb-2">
            <div class="w-0.5 h-3 bg-pit-accent"></div>
            <h3 class="text-[10px] heading-f1 text-pit-text-dim tracking-widest">Pinned Points</h3>
            <div class="flex-1"></div>
            <button
              class="text-[9px] text-pit-text-muted uppercase tracking-wider hover:text-pit-accent transition-colors cursor-pointer font-mono"
              onclick={() => chartState.clearPins()}
            >Clear all</button>
          </div>
          <div class="flex flex-wrap gap-2">
            {#each chartState.pinnedAnnotations as pin}
              <div class="flex items-center gap-1.5 px-2 py-1 text-[9px] font-mono border border-pit-border rounded-sm" style="border-left-color: {pin.color}; border-left-width: 2px;">
                <div class="w-1.5 h-1.5 rounded-full" style="background: {pin.color}"></div>
                <span class="text-pit-text">{pin.driver}</span>
                <span class="text-pit-text-muted">L{pin.lap}</span>
                <span class="text-pit-text-dim">{pin.value}</span>
                <span class="text-pit-text-muted text-[8px]">{pin.chartType}</span>
                <button
                  class="text-pit-text-muted hover:text-pit-accent cursor-pointer ml-0.5"
                  onclick={() => chartState.removePin(pin.id)}
                >×</button>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <div class="space-y-4">
        {#if viewLaps.length > 0}
          <!-- Lap range selector -->
          <LapRangeSelector {maxLap} />

          <LapTimeChart laps={viewLaps} drivers={viewDrivers}
            comparisonLaps={showComparison ? comparisonLaps : []}
            comparisonDrivers={showComparison ? comparisonDrivers : []}
            comparisonLabel={showComparison ? String(comparisonYear) : ''} />
          <GapChart laps={viewLaps} drivers={viewDrivers} />
          <PositionChart laps={viewLaps} drivers={viewDrivers} />

          <!-- Lap time summary table -->
          <LapTimeSummaryTable laps={viewLaps} drivers={viewDrivers} />
        {:else}
          <div class="bg-pit-surface border border-pit-border p-8 text-center text-pit-text-muted text-xs uppercase tracking-wider">
            No lap data available for this session
          </div>
        {/if}

        {#if viewStints.length > 0}
          <StintChart stints={viewStints} drivers={viewDrivers} />
        {/if}
      </div>
    {:else if dataReady && yearLoading}
      <div class="flex items-center justify-center py-20 gap-3">
        <div class="w-7 h-7 spinner-f1"></div>
        <span class="text-pit-text-muted text-xs uppercase tracking-wider">Loading {selectedYear} data...</span>
      </div>
    {/if}

    <!-- Driver Grid -->
    <div class="mt-8">
      <div class="flex items-center gap-2 mb-4">
        <div class="w-0.5 h-3 bg-pit-accent"></div>
        <h2 class="text-[10px] heading-f1 text-pit-text-dim tracking-widest">Driver Grid</h2>
        <div class="flex-1 h-px bg-pit-border"></div>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-px bg-pit-border">
        {#each viewDrivers as driver}
          {@const color = driver.team_colour ? `#${driver.team_colour}` : '#555'}
          <div class="bg-pit-bg p-3 flex items-center gap-3 relative">
            <div class="absolute left-0 top-0 bottom-0 w-[2px]" style="background-color: {color}"></div>
            <div
              class="w-8 h-8 flex items-center justify-center text-xs font-bold text-white shrink-0 data-mono"
              style="background-color: {color}"
            >
              {driver.driver_number}
            </div>
            <div class="min-w-0">
              <p class="text-xs font-bold truncate heading-f1">{driver.name_acronym}</p>
              <p class="text-[10px] text-pit-text-muted truncate">{driver.team_name}</p>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
