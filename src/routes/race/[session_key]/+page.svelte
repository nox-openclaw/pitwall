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

<div class="max-w-7xl mx-auto px-4 py-8">
  <div class="mb-2">
    <a href="/" class="text-pit-text-dim text-sm hover:text-pit-accent transition-colors">&larr; Back to races</a>
  </div>

  {#if loading}
    <div class="flex items-center justify-center py-20">
      <div class="w-8 h-8 border-2 border-pit-accent border-t-transparent rounded-full animate-spin"></div>
      <span class="ml-3 text-pit-text-dim">Loading race data...</span>
    </div>
  {:else if error}
    <div class="text-center py-20">
      <p class="text-pit-text-dim">{error}</p>
      <a href="/" class="text-pit-accent text-sm mt-4 inline-block hover:underline">Back to calendar</a>
    </div>
  {:else if session}
    <div class="mb-8">
      <h1 class="text-3xl font-black tracking-tight mb-1">
        {session.country_name} Grand Prix
      </h1>
      <p class="text-pit-text-dim text-sm">
        {session.circuit_short_name} &middot; {formatDate(session.date_start)}
      </p>
    </div>

    <!-- Stats bar -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
      <div class="bg-pit-surface border border-pit-border rounded-lg p-4">
        <p class="text-xs text-pit-text-dim uppercase tracking-wider mb-1">Drivers</p>
        <p class="text-2xl font-bold font-mono">{drivers.length}</p>
      </div>
      <div class="bg-pit-surface border border-pit-border rounded-lg p-4">
        <p class="text-xs text-pit-text-dim uppercase tracking-wider mb-1">Total Laps</p>
        <p class="text-2xl font-bold font-mono">{laps.length > 0 ? Math.max(...laps.map(l => l.lap_number)) : '-'}</p>
      </div>
      <div class="bg-pit-surface border border-pit-border rounded-lg p-4">
        <p class="text-xs text-pit-text-dim uppercase tracking-wider mb-1">Pit Stops</p>
        <p class="text-2xl font-bold font-mono">{stints.length > 0 ? stints.filter(s => s.stint_number > 1).length : '-'}</p>
      </div>
      <div class="bg-pit-surface border border-pit-border rounded-lg p-4">
        <p class="text-xs text-pit-text-dim uppercase tracking-wider mb-1">Session</p>
        <p class="text-2xl font-bold font-mono">{session.session_type}</p>
      </div>
    </div>

    {#if dataReady}
      <div class="space-y-6">
        {#if laps.length > 0}
          <LapTimeChart {laps} {drivers} />
          <GapChart {laps} {drivers} />
        {:else}
          <div class="bg-pit-surface border border-pit-border rounded-lg p-8 text-center text-pit-text-dim">
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
      <h2 class="text-lg font-bold mb-4">Driver Grid</h2>
      <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
        {#each drivers as driver}
          {@const color = driver.team_colour ? `#${driver.team_colour}` : '#888'}
          <div class="bg-pit-surface border border-pit-border rounded-lg p-3 flex items-center gap-3">
            <div
              class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
              style="background-color: {color}"
            >
              {driver.driver_number}
            </div>
            <div class="min-w-0">
              <p class="text-sm font-bold truncate">{driver.name_acronym}</p>
              <p class="text-xs text-pit-text-dim truncate">{driver.team_name}</p>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
