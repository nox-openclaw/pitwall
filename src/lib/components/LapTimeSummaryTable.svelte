<script lang="ts">
  import * as d3 from 'd3';
  import type { Lap, Driver } from '$lib/api';
  import { getTeamColor } from '$lib/colors';
  import { chartState } from '$lib/chartState.svelte';

  let { laps, drivers }: { laps: Lap[]; drivers: Driver[] } = $props();

  type SortKey = 'fastest' | 'average' | 'consistency' | 'last';
  let sortKey = $state<SortKey>('fastest');
  let sortAsc = $state(true);

  function formatTime(val: number): string {
    const mins = Math.floor(val / 60);
    const secs = (val % 60).toFixed(3);
    return mins > 0 ? `${mins}:${secs.padStart(6, '0')}` : `${secs}s`;
  }

  interface DriverSummary {
    num: number;
    acronym: string;
    team: string;
    color: string;
    fastest: number;
    average: number;
    consistency: number;
    last: number;
    totalLaps: number;
  }

  let summaries = $derived.by((): DriverSummary[] => {
    const [rangeStart, rangeEnd] = chartState.lapRange;
    const valid = laps.filter(l => l.lap_duration && l.lap_duration > 0 && !l.is_pit_out_lap
      && l.lap_number >= rangeStart && l.lap_number <= rangeEnd);
    const grouped = d3.group(valid, d => d.driver_number);

    const result: DriverSummary[] = [];
    for (const [num, data] of grouped) {
      const driver = drivers.find(d => d.driver_number === num);
      if (!driver) continue;
      if (chartState.isHidden(num)) continue;

      const durations = data.map(d => d.lap_duration!).filter(d => d > 0);
      if (!durations.length) continue;

      const fastest = d3.min(durations)!;
      const average = d3.mean(durations)!;
      const consistency = d3.deviation(durations) ?? 0;
      const sorted = data.sort((a, b) => a.lap_number - b.lap_number);
      const last = sorted.at(-1)?.lap_duration ?? 0;

      result.push({
        num,
        acronym: driver.name_acronym,
        team: driver.team_name,
        color: getTeamColor(driver.team_name, driver.team_colour),
        fastest,
        average,
        consistency,
        last,
        totalLaps: durations.length,
      });
    }
    return result;
  });

  let sorted = $derived.by(() => {
    const arr = [...summaries];
    arr.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      return sortAsc ? av - bv : bv - av;
    });
    return arr;
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      sortAsc = !sortAsc;
    } else {
      sortKey = key;
      sortAsc = true;
    }
  }

  function sortIcon(key: SortKey): string {
    if (sortKey !== key) return '';
    return sortAsc ? ' ↑' : ' ↓';
  }
</script>

<div class="bg-pit-surface border border-pit-border p-4">
  <div class="flex items-center gap-2 mb-3">
    <div class="w-0.5 h-3 bg-pit-accent"></div>
    <h3 class="text-[10px] heading-f1 text-pit-text-dim tracking-widest">Lap Time Summary</h3>
  </div>

  {#if sorted.length === 0}
    <p class="text-pit-text-muted text-xs font-mono">No data</p>
  {:else}
    <div class="overflow-x-auto">
      <table class="w-full text-[10px] font-mono">
        <thead>
          <tr class="text-pit-text-muted uppercase tracking-wider border-b border-pit-border">
            <th class="text-left py-2 px-2 font-medium">#</th>
            <th class="text-left py-2 px-2 font-medium">Driver</th>
            <th class="text-left py-2 px-2 font-medium">Team</th>
            <th class="text-right py-2 px-2 font-medium">Laps</th>
            {#each [['fastest', 'Fastest'], ['average', 'Average'], ['consistency', 'Std Dev'], ['last', 'Last Lap']] as [key, label]}
              <th class="text-right py-2 px-2 font-medium">
                <button
                  class="hover:text-pit-accent transition-colors cursor-pointer uppercase tracking-wider"
                  onclick={() => toggleSort(key as SortKey)}
                >
                  {label}{sortIcon(key as SortKey)}
                </button>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each sorted as row, i}
            <tr class="border-b border-pit-border/50 hover:bg-pit-surface-2/50 transition-colors">
              <td class="py-1.5 px-2 text-pit-text-muted">{i + 1}</td>
              <td class="py-1.5 px-2">
                <div class="flex items-center gap-1.5">
                  <div class="w-2 h-2 rounded-full shrink-0" style="background: {row.color}"></div>
                  <span class="text-pit-text font-semibold">{row.acronym}</span>
                </div>
              </td>
              <td class="py-1.5 px-2 text-pit-text-muted truncate max-w-[120px]">{row.team}</td>
              <td class="py-1.5 px-2 text-right text-pit-text-dim">{row.totalLaps}</td>
              <td class="py-1.5 px-2 text-right text-pit-green font-semibold">{formatTime(row.fastest)}</td>
              <td class="py-1.5 px-2 text-right text-pit-text-dim">{formatTime(row.average)}</td>
              <td class="py-1.5 px-2 text-right" class:text-pit-green={row.consistency < 0.5} class:text-pit-yellow={row.consistency >= 0.5 && row.consistency < 1.5} class:text-pit-accent={row.consistency >= 1.5}>
                {row.consistency.toFixed(3)}s
              </td>
              <td class="py-1.5 px-2 text-right text-pit-text-dim">{formatTime(row.last)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
