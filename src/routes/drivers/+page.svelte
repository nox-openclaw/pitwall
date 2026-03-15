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

<div class="max-w-7xl mx-auto px-4 py-6">
  <div class="flex items-center gap-3 mb-6">
    <div class="w-1 h-5 bg-pit-accent"></div>
    <h1 class="heading-f1 text-xl text-pit-text">2026 Driver Lineup</h1>
    <div class="flex-1 h-px bg-pit-border"></div>
    <span class="text-[10px] uppercase tracking-widest text-pit-text-muted data-mono">{drivers.length} Drivers</span>
  </div>

  {#if loading}
    <div class="flex items-center justify-center py-20">
      <div class="w-7 h-7 spinner-f1"></div>
    </div>
  {:else}
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-pit-border">
      {#each drivers as driver}
        {@const color = getTeamColor(driver.team_name, driver.team_colour)}
        <div class="bg-pit-bg p-5 hover:bg-pit-surface transition-all duration-150 group relative">
          <!-- Team color accent -->
          <div class="absolute left-0 top-0 bottom-0 w-[2px]" style="background-color: {color}"></div>

          <div class="flex items-center gap-3 mb-3">
            <div
              class="w-10 h-10 flex items-center justify-center text-sm font-bold text-white data-mono"
              style="background-color: {color}"
            >
              {driver.driver_number}
            </div>
            {#if driver.headshot_url}
              <img
                src={driver.headshot_url}
                alt={driver.full_name}
                class="w-10 h-10 rounded-full object-cover bg-pit-surface"
              />
            {/if}
          </div>
          <h3 class="heading-f1 text-lg text-pit-text">{driver.name_acronym}</h3>
          <p class="text-xs text-pit-text-dim mb-2">{driver.full_name}</p>
          <div class="flex items-center gap-2">
            <div class="w-2 h-2 rounded-sm" style="background-color: {color}"></div>
            <span class="text-[10px] text-pit-text-muted uppercase tracking-wider">{driver.team_name}</span>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
