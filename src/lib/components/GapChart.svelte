<script lang="ts">
  import { onMount } from 'svelte';
  import * as d3 from 'd3';
  import type { Lap, Driver } from '$lib/api';
  import { getTeamColor } from '$lib/colors';

  let { laps, drivers }: { laps: Lap[]; drivers: Driver[] } = $props();

  let container: HTMLDivElement;

  function driverColor(num: number): string {
    const d = drivers.find(d => d.driver_number === num);
    return d ? getTeamColor(d.team_name, d.team_colour) : '#888';
  }

  function driverName(num: number): string {
    const d = drivers.find(d => d.driver_number === num);
    return d?.name_acronym ?? String(num);
  }

  onMount(() => {
    draw();
    return () => { d3.select(container).select('svg').remove(); };
  });

  function draw() {
    const valid = laps.filter(l => l.lap_duration && l.lap_duration > 0);
    if (!valid.length) return;

    const driverNums = [...new Set(valid.map(l => l.driver_number))];
    const grouped = d3.group(valid, d => d.driver_number);
    const maxLap = d3.max(valid, d => d.lap_number)!;

    // Compute cumulative times for each driver
    const cumTimes = new Map<number, Map<number, number>>();
    for (const num of driverNums) {
      const data = grouped.get(num)!.sort((a, b) => a.lap_number - b.lap_number);
      const cum = new Map<number, number>();
      let total = 0;
      for (const lap of data) {
        total += lap.lap_duration!;
        cum.set(lap.lap_number, total);
      }
      cumTimes.set(num, cum);
    }

    // Find leader at each lap (lowest cumulative time)
    type GapPoint = { lap: number; gap: number; driver: number };
    const gapData = new Map<number, GapPoint[]>();

    for (const num of driverNums) {
      gapData.set(num, []);
    }

    for (let lap = 1; lap <= maxLap; lap++) {
      let bestTime = Infinity;
      for (const num of driverNums) {
        const t = cumTimes.get(num)?.get(lap);
        if (t !== undefined && t < bestTime) bestTime = t;
      }
      for (const num of driverNums) {
        const t = cumTimes.get(num)?.get(lap);
        if (t !== undefined) {
          gapData.get(num)!.push({ lap, gap: t - bestTime, driver: num });
        }
      }
    }

    const margin = { top: 20, right: 100, bottom: 40, left: 60 };
    const width = container.clientWidth;
    const height = 400;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const allGaps = Array.from(gapData.values()).flat().map(d => d.gap);
    const maxGap = Math.min(d3.quantile(allGaps.sort(d3.ascending), 0.95)! * 1.2, 120);

    const x = d3.scaleLinear().domain([1, maxLap]).range([margin.left, width - margin.right]);
    const y = d3.scaleLinear().domain([0, maxGap]).range([margin.top, height - margin.bottom]);

    svg.append('g')
      .attr('transform', `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).ticks(10).tickSize(0))
      .call(g => g.select('.domain').attr('stroke', '#2a2a3a'))
      .call(g => g.selectAll('text').attr('fill', '#8888a0').attr('font-size', '11'));

    svg.append('g')
      .attr('transform', `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(6).tickFormat(d => `+${(d as number).toFixed(0)}s`).tickSize(0))
      .call(g => g.select('.domain').attr('stroke', '#2a2a3a'))
      .call(g => g.selectAll('text').attr('fill', '#8888a0').attr('font-size', '11'));

    // Grid
    svg.append('g')
      .selectAll('line')
      .data(y.ticks(6))
      .join('line')
      .attr('x1', margin.left)
      .attr('x2', width - margin.right)
      .attr('y1', d => y(d))
      .attr('y2', d => y(d))
      .attr('stroke', '#1a1a26')
      .attr('stroke-dasharray', '2,3');

    const line = d3.line<GapPoint>()
      .defined(d => d.gap <= maxGap)
      .x(d => x(d.lap))
      .y(d => y(d.gap))
      .curve(d3.curveMonotoneX);

    for (const num of driverNums) {
      const data = gapData.get(num)!;
      const color = driverColor(num);

      svg.append('path')
        .datum(data)
        .attr('d', line)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 1.5)
        .attr('opacity', 0.8);

      const last = data.filter(d => d.gap <= maxGap).at(-1);
      if (last) {
        svg.append('text')
          .attr('x', x(last.lap) + 6)
          .attr('y', y(last.gap))
          .attr('fill', color)
          .attr('font-size', '10')
          .attr('font-family', 'JetBrains Mono, monospace')
          .attr('dominant-baseline', 'middle')
          .text(driverName(num));
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
  <h3 class="text-sm font-semibold text-pit-text-dim mb-3 uppercase tracking-wider">Gap to Leader</h3>
  <div bind:this={container} class="w-full overflow-x-auto"></div>
</div>
