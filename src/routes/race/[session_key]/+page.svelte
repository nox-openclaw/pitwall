<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import type { Session, Driver, Lap, Stint } from '$lib/api';
  import { getSessions, getDrivers, getLaps, getStints, uniqueDrivers } from '$lib/api';
  import LapTimeChart from '$lib/components/LapTimeChart.svelte';
  import GapChart from '$lib/components/GapChart.svelte';
  import StintChart from '$lib/components/StintChart.svelte';

  let sessionKey = $derived(Number($page.params.session_key));

  let session = $state<Session | null>(null);
  let drivers = $state<Driver[]>([]);
  let laps = $state<Lap[]>([]);
  let stints = $state<Stint[]>([]);
  let loading = $state(true);
  let error = $state('');
  let dataReady = $state(false);

  onMount(async () => {
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
      dataReady = true;
    } catch (e) {
      error = 'Failed to load race data. This session may not exist or the API may be unavailable.';
      console.error(e);
    } finally {
      loading = false;
    }
  });

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
    <!-- Race header -->
    <div class="mb-8 border-b border-pit-border pb-6">
      <div class="flex items-center gap-3 mb-2">
        <div class="w-1 h-6 bg-pit-accent"></div>
        <span class="text-[10px] uppercase tracking-widest text-pit-accent font-semibold data-mono">{session.session_type}</span>
      </div>
      <h1 class="heading-f1 text-3xl sm:text-4xl text-pit-text mb-1">
        {session.country_name} Grand Prix
      </h1>
      <p class="text-xs text-pit-text-muted font-mono tracking-wide">
        {session.circuit_short_name} &middot; {formatDate(session.date_start)}
      </p>
    </div>

    <!-- Stats bar -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-px bg-pit-border mb-8">
      <div class="bg-pit-bg p-4">
        <p class="text-[10px] text-pit-text-muted uppercase tracking-widest mb-1">Drivers</p>
        <p class="text-2xl font-bold data-mono text-pit-text">{drivers.length}</p>
      </div>
      <div class="bg-pit-bg p-4">
        <p class="text-[10px] text-pit-text-muted uppercase tracking-widest mb-1">Total Laps</p>
        <p class="text-2xl font-bold data-mono text-pit-text">{laps.length > 0 ? Math.max(...laps.map(l => l.lap_number)) : '-'}</p>
      </div>
      <div class="bg-pit-bg p-4">
        <p class="text-[10px] text-pit-text-muted uppercase tracking-widest mb-1">Pit Stops</p>
        <p class="text-2xl font-bold data-mono text-pit-text">{stints.length > 0 ? stints.filter(s => s.stint_number > 1).length : '-'}</p>
      </div>
      <div class="bg-pit-bg p-4">
        <p class="text-[10px] text-pit-text-muted uppercase tracking-widest mb-1">Session</p>
        <p class="text-2xl font-bold data-mono text-pit-text">{session.session_type}</p>
      </div>
    </div>

    {#if dataReady}
      <div class="space-y-4">
        {#if laps.length > 0}
          <LapTimeChart {laps} {drivers} />
          <GapChart {laps} {drivers} />
        {:else}
          <div class="bg-pit-surface border border-pit-border p-8 text-center text-pit-text-muted text-xs uppercase tracking-wider">
            No lap data available for this session
          </div>
        {/if}

        {#if stints.length > 0}
          <StintChart {stints} {drivers} />
        {/if}
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
        {#each drivers as driver}
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
