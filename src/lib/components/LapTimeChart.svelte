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
    const valid = laps.filter(l => l.lap_duration && l.lap_duration > 0 && !l.is_pit_out_lap);
    if (!valid.length) return;

    const driverNums = [...new Set(valid.map(l => l.driver_number))];
    const grouped = d3.group(valid, d => d.driver_number);

    const margin = { top: 20, right: 100, bottom: 40, left: 60 };
    const width = container.clientWidth;
    const height = 400;

    const svg = d3.select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    const maxLap = d3.max(valid, d => d.lap_number)!;
    const durations = valid.map(d => d.lap_duration!);
    const medianLap = d3.median(durations)!;
    const yMin = Math.max(d3.min(durations)! - 2, medianLap - 8);
    const yMax = Math.min(d3.max(durations)!, medianLap + 12);

    const x = d3.scaleLinear().domain([1, maxLap]).range([margin.left, width - margin.right]);
    const y = d3.scaleLinear().domain([yMin, yMax]).range([height - margin.bottom, margin.top]);

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
      .call(d3.axisLeft(y).ticks(6).tickFormat(d => {
        const val = d as number;
        const mins = Math.floor(val / 60);
        const secs = (val % 60).toFixed(1);
        return mins > 0 ? `${mins}:${secs.padStart(4, '0')}` : `${secs}s`;
      }).tickSize(0))
      .call(g => g.select('.domain').attr('stroke', '#2A2A2A'))
      .call(g => g.selectAll('text').attr('fill', '#6B6B6B').attr('font-size', '10').attr('font-family', 'JetBrains Mono, monospace'));

    const line = d3.line<Lap>()
      .defined(d => d.lap_duration != null && d.lap_duration > yMin && d.lap_duration < yMax)
      .x(d => x(d.lap_number))
      .y(d => y(d.lap_duration!))
      .curve(d3.curveMonotoneX);

    // Find race leader (driver with lowest total lap time)
    let leaderNum = driverNums[0];
    let lowestTotal = Infinity;
    for (const num of driverNums) {
      const data = grouped.get(num)!;
      const total = d3.sum(data, d => d.lap_duration ?? 0);
      if (total < lowestTotal && total > 0) {
        lowestTotal = total;
        leaderNum = num;
      }
    }

    for (const num of driverNums) {
      const data = grouped.get(num)!.sort((a, b) => a.lap_number - b.lap_number);
      const color = driverColor(num);
      const isLeader = num === leaderNum;

      svg.append('path')
        .datum(data)
        .attr('d', line)
        .attr('fill', 'none')
        .attr('stroke', isLeader ? '#E8002D' : color)
        .attr('stroke-width', isLeader ? 2 : 1.2)
        .attr('opacity', isLeader ? 1 : 0.6);

      // Label at end
      const last = data[data.length - 1];
      if (last && last.lap_duration && last.lap_duration > yMin && last.lap_duration < yMax) {
        svg.append('text')
          .attr('x', x(last.lap_number) + 6)
          .attr('y', y(last.lap_duration!))
          .attr('fill', isLeader ? '#E8002D' : color)
          .attr('font-size', '9')
          .attr('font-weight', isLeader ? '700' : '500')
          .attr('font-family', 'JetBrains Mono, monospace')
          .attr('dominant-baseline', 'middle')
          .text(driverName(num));
      }
    }

    // Axis label
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', height - 4)
      .attr('fill', '#6B6B6B')
      .attr('text-anchor', 'middle')
      .attr('font-size', '10')
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('text-transform', 'uppercase')
      .text('LAP');
  }
</script>

<div class="bg-pit-surface border border-pit-border p-4">
  <div class="flex items-center gap-2 mb-3">
    <div class="w-0.5 h-3 bg-pit-accent"></div>
    <h3 class="text-[10px] heading-f1 text-pit-text-dim tracking-widest">Lap Times</h3>
  </div>
  <div bind:this={container} class="w-full overflow-x-auto"></div>
</div>
