<script lang="ts">
  import * as d3 from 'd3';
  import type { Stint, Driver } from '$lib/api';
  import { getTeamColor, TYRE_COLORS } from '$lib/colors';
  import { chartState } from '$lib/chartState.svelte';

  let { stints, drivers }: { stints: Stint[]; drivers: Driver[] } = $props();

  let container: HTMLDivElement;
  let tooltipX = $state(0);
  let tooltipY = $state(0);
  let tooltipVisible = $state(false);
  let tooltipDriver = $state('');
  let tooltipCompound = $state('');
  let tooltipLaps = $state('');
  let tooltipAge = $state('');
  let tooltipColor = $state('#fff');

  function driverName(num: number): string {
    const d = drivers.find(d => d.driver_number === num);
    return d?.name_acronym ?? String(num);
  }

  function driverColor(num: number): string {
    const d = drivers.find(d => d.driver_number === num);
    return d ? getTeamColor(d.team_name, d.team_colour) : '#555';
  }

  $effect(() => {
    const _stints = stints;
    const _drivers = drivers;
    void chartState.hiddenDrivers;

    if (!container || !_stints.length) return;

    d3.select(container).selectAll('*').remove();
    tooltipVisible = false;
    draw();

    return () => { d3.select(container).selectAll('*').remove(); };
  });

  function draw() {
    if (!stints.length) return;

    const allDriverNums = [...new Set(stints.map(s => s.driver_number))];
    const visibleNums = allDriverNums.filter(n => !chartState.isHidden(n));
    const maxLap = d3.max(stints, s => s.lap_end) ?? 60;

    const margin = { top: 10, right: 20, bottom: 40, left: 60 };
    const width = container.clientWidth;
    const rowH = 26;
    const height = margin.top + margin.bottom + visibleNums.length * rowH;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const x = d3.scaleLinear().domain([1, maxLap]).range([margin.left, width - margin.right]);
    const y = d3.scaleBand<number>().domain(visibleNums).range([margin.top, height - margin.bottom]).padding(0.3);

    // Horizontal row separators
    svg.append('g')
      .selectAll('line')
      .data(visibleNums)
      .join('line')
      .attr('x1', margin.left)
      .attr('x2', width - margin.right)
      .attr('y1', d => (y(d) ?? 0) + y.bandwidth() + y.step() * 0.15)
      .attr('y2', d => (y(d) ?? 0) + y.bandwidth() + y.step() * 0.15)
      .attr('stroke', '#1E1E1E')
      .attr('stroke-width', 0.5);

    svg.append('g')
      .attr('transform', `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).ticks(10).tickSize(0))
      .call(g => g.select('.domain').attr('stroke', '#2A2A2A'))
      .call(g => g.selectAll('text').attr('fill', '#6B6B6B').attr('font-size', '10').attr('font-family', 'JetBrains Mono, monospace'));

    // Driver labels
    svg.selectAll('.driver-label')
      .data(visibleNums)
      .join('text')
      .attr('x', margin.left - 6)
      .attr('y', d => (y(d) ?? 0) + y.bandwidth() / 2)
      .attr('fill', d => driverColor(d))
      .attr('font-size', '9')
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle')
      .text(d => driverName(d));

    // Stint bars (only for visible drivers)
    const visibleStints = stints.filter(s => !chartState.isHidden(s.driver_number));

    for (const stint of visibleStints) {
      const yPos = y(stint.driver_number);
      if (yPos === undefined) continue;

      const compound = stint.compound?.toUpperCase() ?? 'UNKNOWN';
      const color = TYRE_COLORS[compound] ?? TYRE_COLORS.UNKNOWN;

      svg.append('rect')
        .attr('x', x(stint.lap_start))
        .attr('y', yPos)
        .attr('width', Math.max(x(stint.lap_end) - x(stint.lap_start), 2))
        .attr('height', y.bandwidth())
        .attr('rx', 2)
        .attr('fill', color)
        .attr('opacity', 0.9)
        .attr('cursor', 'pointer')
        .on('mouseenter', (event: MouseEvent) => {
          const [mx, my] = d3.pointer(event, container);
          const cw = container.clientWidth;
          tooltipX = mx > cw * 0.65 ? mx - 140 : mx + 14;
          tooltipY = my - 10;
          tooltipVisible = true;
          tooltipDriver = driverName(stint.driver_number);
          tooltipCompound = compound;
          tooltipLaps = `Lap ${stint.lap_start} → ${stint.lap_end}`;
          tooltipAge = `${stint.tyre_age_at_start} laps old`;
          tooltipColor = color;
        })
        .on('mousemove', (event: MouseEvent) => {
          const [mx, my] = d3.pointer(event, container);
          const cw = container.clientWidth;
          tooltipX = mx > cw * 0.65 ? mx - 140 : mx + 14;
          tooltipY = my - 10;
        })
        .on('mouseleave', () => {
          tooltipVisible = false;
        });

      // Compound label
      const barWidth = x(stint.lap_end) - x(stint.lap_start);
      if (barWidth > 25) {
        svg.append('text')
          .attr('x', x(stint.lap_start) + barWidth / 2)
          .attr('y', yPos + y.bandwidth() / 2)
          .attr('fill', compound === 'HARD' ? '#1E1E1E' : '#0A0A0A')
          .attr('font-size', '8')
          .attr('font-weight', '700')
          .attr('font-family', 'JetBrains Mono, monospace')
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('pointer-events', 'none')
          .text(compound[0]);
      }
    }

    svg.append('text')
      .attr('x', width / 2)
      .attr('y', height - 4)
      .attr('fill', '#6B6B6B')
      .attr('text-anchor', 'middle')
      .attr('font-size', '10')
      .attr('font-family', 'JetBrains Mono, monospace')
      .text('LAP');
  }
</script>

<div class="bg-pit-surface border border-pit-border p-4">
  <div class="flex items-center gap-2 mb-3">
    <div class="w-0.5 h-3 bg-pit-accent"></div>
    <h3 class="text-[10px] heading-f1 text-pit-text-dim tracking-widest">Tyre Strategy</h3>
  </div>
  <div class="flex gap-4 mb-3">
    {#each Object.entries(TYRE_COLORS).slice(0, 5) as [name, color]}
      <div class="flex items-center gap-1.5">
        <div class="w-2.5 h-2.5 rounded-sm" style="background-color: {color}"></div>
        <span class="text-[10px] text-pit-text-muted uppercase tracking-wider font-mono">{name}</span>
      </div>
    {/each}
  </div>
  <div class="relative">
    <div
      class="absolute pointer-events-none z-10 px-3 py-2 text-[10px] font-mono transition-opacity duration-150 border rounded-sm"
      style="left: {tooltipX}px; top: {tooltipY}px; opacity: {tooltipVisible ? 1 : 0}; background: #1E1E1E; border-color: #E8002D; color: white; white-space: nowrap;"
    >
      <div class="flex items-center gap-1.5 mb-0.5">
        <div class="w-2 h-2 rounded-full" style="background: {tooltipColor}"></div>
        <span class="font-bold text-[11px]">{tooltipDriver}</span>
      </div>
      <div class="text-white">{tooltipCompound}</div>
      <div class="text-[#6B6B6B]">{tooltipLaps}</div>
      <div class="text-[#6B6B6B]">{tooltipAge}</div>
    </div>
    <div bind:this={container} class="w-full overflow-x-auto"></div>
  </div>
</div>
