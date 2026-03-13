<script lang="ts">
  import { onMount } from 'svelte';
  import * as d3 from 'd3';
  import type { Stint, Driver } from '$lib/api';
  import { getTeamColor, TYRE_COLORS } from '$lib/colors';

  let { stints, drivers }: { stints: Stint[]; drivers: Driver[] } = $props();

  let container: HTMLDivElement;

  function driverName(num: number): string {
    const d = drivers.find(d => d.driver_number === num);
    return d?.name_acronym ?? String(num);
  }

  function driverColor(num: number): string {
    const d = drivers.find(d => d.driver_number === num);
    return d ? getTeamColor(d.team_name, d.team_colour) : '#888';
  }

  onMount(() => {
    draw();
    return () => { d3.select(container).select('svg').remove(); };
  });

  function draw() {
    if (!stints.length) return;

    const driverNums = [...new Set(stints.map(s => s.driver_number))];
    const maxLap = d3.max(stints, s => s.lap_end) ?? 60;

    const margin = { top: 10, right: 20, bottom: 40, left: 60 };
    const width = container.clientWidth;
    const rowH = 28;
    const height = margin.top + margin.bottom + driverNums.length * rowH;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const x = d3.scaleLinear().domain([1, maxLap]).range([margin.left, width - margin.right]);
    const y = d3.scaleBand<number>().domain(driverNums).range([margin.top, height - margin.bottom]).padding(0.3);

    svg.append('g')
      .attr('transform', `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).ticks(10).tickSize(0))
      .call(g => g.select('.domain').attr('stroke', '#2a2a3a'))
      .call(g => g.selectAll('text').attr('fill', '#8888a0').attr('font-size', '11'));

    // Driver labels
    svg.selectAll('.driver-label')
      .data(driverNums)
      .join('text')
      .attr('x', margin.left - 6)
      .attr('y', d => (y(d) ?? 0) + y.bandwidth() / 2)
      .attr('fill', d => driverColor(d))
      .attr('font-size', '10')
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle')
      .text(d => driverName(d));

    // Stint bars
    for (const stint of stints) {
      const yPos = y(stint.driver_number);
      if (yPos === undefined) continue;

      const compound = stint.compound?.toUpperCase() ?? 'UNKNOWN';
      const color = TYRE_COLORS[compound] ?? TYRE_COLORS.UNKNOWN;

      svg.append('rect')
        .attr('x', x(stint.lap_start))
        .attr('y', yPos)
        .attr('width', Math.max(x(stint.lap_end) - x(stint.lap_start), 2))
        .attr('height', y.bandwidth())
        .attr('rx', 3)
        .attr('fill', color)
        .attr('opacity', 0.85);

      // Compound label
      const barWidth = x(stint.lap_end) - x(stint.lap_start);
      if (barWidth > 25) {
        svg.append('text')
          .attr('x', x(stint.lap_start) + barWidth / 2)
          .attr('y', yPos + y.bandwidth() / 2)
          .attr('fill', compound === 'HARD' ? '#333' : '#000')
          .attr('font-size', '9')
          .attr('font-weight', '600')
          .attr('font-family', 'JetBrains Mono, monospace')
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .text(compound[0]);
      }
    }

    svg.append('text')
      .attr('x', width / 2)
      .attr('y', height - 4)
      .attr('fill', '#8888a0')
      .attr('text-anchor', 'middle')
      .attr('font-size', '11')
      .text('Lap');
  }
</script>

<div class="bg-pit-surface border border-pit-border rounded-lg p-4">
  <h3 class="text-sm font-semibold text-pit-text-dim mb-3 uppercase tracking-wider">Tyre Strategy</h3>
  <div class="flex gap-4 mb-3">
    {#each Object.entries(TYRE_COLORS).slice(0, 5) as [name, color]}
      <div class="flex items-center gap-1.5">
        <div class="w-3 h-3 rounded-full" style="background-color: {color}"></div>
        <span class="text-xs text-pit-text-dim capitalize">{name.toLowerCase()}</span>
      </div>
    {/each}
  </div>
  <div bind:this={container} class="w-full overflow-x-auto"></div>
</div>
