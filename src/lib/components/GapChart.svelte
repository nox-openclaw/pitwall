<script lang="ts">
  import { onMount } from 'svelte';
  import * as d3 from 'd3';
  import type { Lap, Driver } from '$lib/api';
  import { getTeamColor } from '$lib/colors';

  let { laps, drivers }: { laps: Lap[]; drivers: Driver[] } = $props();

  let container: HTMLDivElement;

  function driverColor(num: number): string {
    const d = drivers.find(d => d.driver_number === num);
    return d ? getTeamColor(d.team_name, d.team_colour) : '#555';
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

    // Find leader at each lap
    type GapPoint = { lap: number; gap: number; driver: number };
    const gapData = new Map<number, GapPoint[]>();
    let leaderNum = driverNums[0];

    for (const num of driverNums) {
      gapData.set(num, []);
    }

    for (let lap = 1; lap <= maxLap; lap++) {
      let bestTime = Infinity;
      let bestDriver = driverNums[0];
      for (const num of driverNums) {
        const t = cumTimes.get(num)?.get(lap);
        if (t !== undefined && t < bestTime) {
          bestTime = t;
          bestDriver = num;
        }
      }
      if (lap === maxLap) leaderNum = bestDriver;
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

    // Grid lines
    svg.append('g')
      .selectAll('line')
      .data(y.ticks(6))
      .join('line')
      .attr('x1', margin.left)
      .attr('x2', width - margin.right)
      .attr('y1', d => y(d))
      .attr('y2', d => y(d))
      .attr('stroke', '#1E1E1E')
      .attr('stroke-width', 0.5);

    // Axes
    svg.append('g')
      .attr('transform', `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).ticks(10).tickSize(0))
      .call(g => g.select('.domain').attr('stroke', '#2A2A2A'))
      .call(g => g.selectAll('text').attr('fill', '#6B6B6B').attr('font-size', '10').attr('font-family', 'JetBrains Mono, monospace'));

    svg.append('g')
      .attr('transform', `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(6).tickFormat(d => `+${(d as number).toFixed(0)}s`).tickSize(0))
      .call(g => g.select('.domain').attr('stroke', '#2A2A2A'))
      .call(g => g.selectAll('text').attr('fill', '#6B6B6B').attr('font-size', '10').attr('font-family', 'JetBrains Mono, monospace'));

    const line = d3.line<GapPoint>()
      .defined(d => d.gap <= maxGap)
      .x(d => x(d.lap))
      .y(d => y(d.gap))
      .curve(d3.curveMonotoneX);

    for (const num of driverNums) {
      const data = gapData.get(num)!;
      const color = driverColor(num);
      const isLeader = num === leaderNum;

      svg.append('path')
        .datum(data)
        .attr('d', line)
        .attr('fill', 'none')
        .attr('stroke', isLeader ? '#E8002D' : color)
        .attr('stroke-width', isLeader ? 2 : 1.2)
        .attr('opacity', isLeader ? 1 : 0.6);

      const last = data.filter(d => d.gap <= maxGap).at(-1);
      if (last) {
        svg.append('text')
          .attr('x', x(last.lap) + 6)
          .attr('y', y(last.gap))
          .attr('fill', isLeader ? '#E8002D' : color)
          .attr('font-size', '9')
          .attr('font-weight', isLeader ? '700' : '500')
          .attr('font-family', 'JetBrains Mono, monospace')
          .attr('dominant-baseline', 'middle')
          .text(driverName(num));
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
    <h3 class="text-[10px] heading-f1 text-pit-text-dim tracking-widest">Gap to Leader</h3>
  </div>
  <div bind:this={container} class="w-full overflow-x-auto"></div>
</div>
