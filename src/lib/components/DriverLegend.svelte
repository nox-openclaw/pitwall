<script lang="ts">
  import type { Driver } from '$lib/api';
  import { getTeamColor } from '$lib/colors';
  import { chartState } from '$lib/chartState.svelte';

  let { drivers }: { drivers: Driver[] } = $props();
</script>

<div class="bg-pit-surface border border-pit-border p-4">
  <div class="flex items-center gap-2 mb-3">
    <div class="w-0.5 h-3 bg-pit-accent"></div>
    <h3 class="text-[10px] heading-f1 text-pit-text-dim tracking-widest">Drivers</h3>
    <div class="flex-1 h-px bg-pit-border"></div>
    {#if chartState.hiddenDrivers.length > 0}
      <button
        class="text-[9px] text-pit-text-muted uppercase tracking-wider hover:text-pit-accent transition-colors cursor-pointer font-mono"
        onclick={() => chartState.reset()}
      >Show all</button>
    {/if}
  </div>
  <div class="flex flex-wrap gap-x-4 gap-y-1.5">
    {#each drivers as driver}
      {@const color = getTeamColor(driver.team_name, driver.team_colour)}
      {@const hidden = chartState.isHidden(driver.driver_number)}
      <button
        class="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider transition-opacity duration-200 cursor-pointer border-none bg-transparent p-0"
        class:opacity-30={hidden}
        onclick={() => chartState.toggle(driver.driver_number)}
      >
        <div class="w-3 h-[3px] rounded-sm shrink-0" style="background-color: {color}"></div>
        <span
          class="transition-colors duration-150"
          class:line-through={hidden}
          class:text-pit-text-muted={hidden}
          class:text-pit-text-dim={!hidden}
          style="text-decoration-color: {hidden ? '#6B6B6B' : 'transparent'}"
        >
          {driver.name_acronym}
        </span>
      </button>
    {/each}
  </div>
</div>
