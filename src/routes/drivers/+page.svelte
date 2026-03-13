<script lang="ts">
  import { onMount } from 'svelte';
  import type { Driver } from '$lib/api';
  import { getDrivers, uniqueDrivers } from '$lib/api';
  import { getTeamColor } from '$lib/colors';

  // Use a known recent session for driver data
  const SESSION_KEY = 9574;

  let drivers = $state<Driver[]>([]);
  let loading = $state(true);

  onMount(async () => {
    try {
      const raw = await getDrivers(SESSION_KEY);
      drivers = uniqueDrivers(raw).sort((a, b) => a.team_name.localeCompare(b.team_name));
    } catch (e) {
      console.error(e);
    } finally {
      loading = false;
    }
  });
</script>

<div class="max-w-7xl mx-auto px-4 py-8">
  <div class="mb-8">
    <h1 class="text-3xl font-black tracking-tight mb-1">Drivers</h1>
    <p class="text-pit-text-dim text-sm">2024 FIA Formula 1 driver lineup</p>
  </div>

  {#if loading}
    <div class="flex items-center justify-center py-20">
      <div class="w-8 h-8 border-2 border-pit-accent border-t-transparent rounded-full animate-spin"></div>
    </div>
  {:else}
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {#each drivers as driver}
        {@const color = getTeamColor(driver.team_name, driver.team_colour)}
        <div class="bg-pit-surface border border-pit-border rounded-lg p-5 hover:border-pit-accent/30 transition-all group">
          <div class="flex items-center gap-3 mb-3">
            <div
              class="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white"
              style="background-color: {color}"
            >
              {driver.driver_number}
            </div>
            {#if driver.headshot_url}
              <img
                src={driver.headshot_url}
                alt={driver.full_name}
                class="w-10 h-10 rounded-full object-cover bg-pit-surface-2"
              />
            {/if}
          </div>
          <h3 class="font-bold text-pit-text text-lg">{driver.name_acronym}</h3>
          <p class="text-sm text-pit-text-dim mb-2">{driver.full_name}</p>
          <div class="flex items-center gap-2">
            <div class="w-3 h-3 rounded-full" style="background-color: {color}"></div>
            <span class="text-xs text-pit-text-dim">{driver.team_name}</span>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
