<script lang="ts">
  import type { Driver, Lap } from '$lib/api';
  import * as d3 from 'd3';
  import { getTeamColor } from '$lib/colors';
  import { chartState } from '$lib/chartState.svelte';

  let { drivers, laps = [] }: { drivers: Driver[]; laps?: Lap[] } = $props();

  let allNums = $derived(drivers.map(d => d.driver_number));

  // Compute position-based rankings from lap data for presets
  let rankedNums = $derived.by(() => {
    if (!laps.length) return allNums;
    const valid = laps.filter(l => l.lap_duration && l.lap_duration > 0);
    const grouped = d3.group(valid, d => d.driver_number);
    const totals: { num: number; total: number }[] = [];
    for (const [num, data] of grouped) {
      const total = d3.sum(data, d => d.lap_duration ?? 0);
      if (total > 0) totals.push({ num, total });
    }
    totals.sort((a, b) => a.total - b.total);
    return totals.map(t => t.num);
  });

  function preset(type: 'all' | 'none' | 'top5' | 'front' | 'mid') {
    if (type === 'all') return chartState.reset();
    if (type === 'none') return chartState.hideAll(allNums);
    const ranked = rankedNums;
    if (type === 'top5') return chartState.hideAllExcept(allNums, ranked.slice(0, 5));
    if (type === 'front') return chartState.hideAllExcept(allNums, ranked.slice(0, 10));
    if (type === 'mid') return chartState.hideAllExcept(allNums, ranked.slice(10, 20));
  }
</script>

<div class="bg-pit-surface border border-pit-border p-4">
  <div class="flex items-center gap-2 mb-3">
    <div class="w-0.5 h-3 bg-pit-accent"></div>
    <h3 class="text-[10px] heading-f1 text-pit-text-dim tracking-widest">Drivers</h3>
    <div class="flex-1 h-px bg-pit-border"></div>
    <div class="flex gap-2">
      {#each [['all', 'All'], ['none', 'None'], ['top5', 'Top 5'], ['front', 'P1-P10'], ['mid', 'P11-P20']] as [key, label]}
        <button
          class="text-[9px] text-pit-text-muted uppercase tracking-wider hover:text-pit-accent transition-colors cursor-pointer font-mono px-1.5 py-0.5 border border-pit-border rounded-sm hover:border-pit-accent/40"
          onclick={() => preset(key as 'all' | 'none' | 'top5' | 'front' | 'mid')}
        >{label}</button>
      {/each}
    </div>
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
        <div class="w-2 h-2 rounded-full shrink-0" style="background-color: {color}"></div>
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
