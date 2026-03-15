<script lang="ts">
  import * as d3 from 'd3';
  import type { Lap, Driver } from '$lib/api';
  import { getTeamColor } from '$lib/colors';
  import { chartState, type PinnedAnnotation } from '$lib/chartState.svelte';

  let { laps, drivers }: { laps: Lap[]; drivers: Driver[] } = $props();

  let container: HTMLDivElement;
  let tooltipX = $state(0);
  let tooltipY = $state(0);
  let tooltipVisible = $state(false);
  let tooltipDriver = $state('');
  let tooltipLap = $state(0);
  let tooltipValue = $state('');
  let tooltipColor = $state('#fff');
  let zoomLabel = $state('');

  function driverColor(num: number): string {
    const d = drivers.find(d => d.driver_number === num);
    return d ? getTeamColor(d.team_name, d.team_colour) : '#555';
  }

  function driverName(num: number): string {
    const d = drivers.find(d => d.driver_number === num);
    return d?.name_acronym ?? String(num);
  }

  let pins = $derived(chartState.pinnedAnnotations.filter(p => p.chartType === 'gap'));

  $effect(() => {
    const _laps = laps;
    const _drivers = drivers;
    void chartState.hiddenDrivers;
    void chartState.lapRange;

    if (!container || !_laps.length) return;

    d3.select(container).selectAll('*').remove();
    tooltipVisible = false;
    zoomLabel = '';
    draw();

    return () => { d3.select(container).selectAll('*').remove(); };
  });

  function draw() {
    const [rangeStart, rangeEnd] = chartState.lapRange;
    const valid = laps.filter(l => l.lap_duration && l.lap_duration > 0
      && l.lap_number >= rangeStart && l.lap_number <= rangeEnd);
    if (!valid.length) return;

    const allDriverNums = [...new Set(valid.map(l => l.driver_number))];
    const grouped = d3.group(valid, d => d.driver_number);
    const maxLap = d3.max(valid, d => d.lap_number)!;
    const minLap = d3.min(valid, d => d.lap_number)!;

    // Compute cumulative times
    const cumTimes = new Map<number, Map<number, number>>();
    for (const num of allDriverNums) {
      const data = grouped.get(num)!.sort((a, b) => a.lap_number - b.lap_number);
      const cum = new Map<number, number>();
      let total = 0;
      for (const lap of data) {
        total += lap.lap_duration!;
        cum.set(lap.lap_number, total);
      }
      cumTimes.set(num, cum);
    }

    // Find leader at each lap and compute gaps
    type GapPoint = { lap: number; gap: number; driver: number };
    const gapData = new Map<number, GapPoint[]>();
    let leaderNum = allDriverNums[0];

    for (const num of allDriverNums) {
      gapData.set(num, []);
    }

    for (let lap = minLap; lap <= maxLap; lap++) {
      let bestTime = Infinity;
      let bestDriver = allDriverNums[0];
      for (const num of allDriverNums) {
        const t = cumTimes.get(num)?.get(lap);
        if (t !== undefined && t < bestTime) {
          bestTime = t;
          bestDriver = num;
        }
      }
      if (lap === maxLap) leaderNum = bestDriver;
      for (const num of allDriverNums) {
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

    const xBase = d3.scaleLinear().domain([minLap, maxLap]).range([margin.left, width - margin.right]);
    const y = d3.scaleLinear().domain([0, maxGap]).range([margin.top, height - margin.bottom]);

    // Clip path
    svg.append('defs').append('clipPath').attr('id', 'clip-gap')
      .append('rect')
      .attr('x', margin.left).attr('y', margin.top)
      .attr('width', width - margin.left - margin.right)
      .attr('height', height - margin.top - margin.bottom);

    const chartArea = svg.append('g').attr('clip-path', 'url(#clip-gap)');
    let x = xBase.copy();

    function drawContent() {
      chartArea.selectAll('*').remove();

      // Grid lines
      chartArea.append('g')
        .selectAll('line')
        .data(y.ticks(6))
        .join('line')
        .attr('x1', margin.left).attr('x2', width - margin.right)
        .attr('y1', d => y(d)).attr('y2', d => y(d))
        .attr('stroke', '#1E1E1E').attr('stroke-width', 0.5);

      const line = d3.line<GapPoint>()
        .defined(d => d.gap <= maxGap)
        .x(d => x(d.lap))
        .y(d => y(d.gap))
        .curve(d3.curveMonotoneX);

      const visibleNums = allDriverNums.filter(n => !chartState.isHidden(n));

      for (const num of visibleNums) {
        const data = gapData.get(num)!;
        const color = driverColor(num);
        const isLeader = num === leaderNum;

        chartArea.append('path')
          .datum(data)
          .attr('d', line)
          .attr('fill', 'none')
          .attr('stroke', isLeader ? '#E8002D' : color)
          .attr('stroke-width', isLeader ? 2 : 1.2)
          .attr('opacity', isLeader ? 1 : 0.6);

        const last = data.filter(d => d.gap <= maxGap).at(-1);
        if (last) {
          chartArea.append('text')
            .attr('x', x(last.lap) + 6).attr('y', y(last.gap))
            .attr('fill', isLeader ? '#E8002D' : color)
            .attr('font-size', '9').attr('font-weight', isLeader ? '700' : '500')
            .attr('font-family', 'JetBrains Mono, monospace')
            .attr('dominant-baseline', 'middle')
            .text(driverName(num));
        }
      }

      // Pinned annotations
      for (const pin of chartState.pinnedAnnotations.filter(p => p.chartType === 'gap')) {
        const data = gapData.get(pin.driverNum);
        if (!data) continue;
        const point = data.find(d => d.lap === pin.lap);
        if (!point) continue;
        chartArea.append('circle')
          .attr('cx', x(pin.lap)).attr('cy', y(point.gap)).attr('r', 5)
          .attr('fill', pin.color).attr('stroke', '#fff').attr('stroke-width', 1.5);
      }
    }

    const xAxisG = svg.append('g').attr('transform', `translate(0,${height - margin.bottom})`);
    const yAxisG = svg.append('g').attr('transform', `translate(${margin.left},0)`);

    function drawAxes() {
      xAxisG.call(d3.axisBottom(x).ticks(10).tickSize(0))
        .call(g => g.select('.domain').attr('stroke', '#2A2A2A'))
        .call(g => g.selectAll('text').attr('fill', '#6B6B6B').attr('font-size', '10').attr('font-family', 'JetBrains Mono, monospace'));

      yAxisG.call(d3.axisLeft(y).ticks(6).tickFormat(d => `+${(d as number).toFixed(0)}s`).tickSize(0))
        .call(g => g.select('.domain').attr('stroke', '#2A2A2A'))
        .call(g => g.selectAll('text').attr('fill', '#6B6B6B').attr('font-size', '10').attr('font-family', 'JetBrains Mono, monospace'));
    }

    drawContent();
    drawAxes();

    // Zoom indicator
    const zoomIndicatorSvg = svg.append('text')
      .attr('x', width - margin.right).attr('y', margin.top - 6)
      .attr('fill', '#E8002D').attr('text-anchor', 'end')
      .attr('font-size', '9').attr('font-family', 'JetBrains Mono, monospace')
      .attr('opacity', 0);

    // Hover elements
    const focus = svg.append('g').style('display', 'none');
    focus.append('line')
      .attr('y1', margin.top).attr('y2', height - margin.bottom)
      .attr('stroke', '#E8002D').attr('stroke-width', 0.5).attr('stroke-dasharray', '3,3');
    focus.append('circle')
      .attr('r', 4).attr('fill', '#1E1E1E').attr('stroke', '#E8002D').attr('stroke-width', 1.5);

    // Zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 20])
      .translateExtent([[margin.left, 0], [width - margin.right, height]])
      .extent([[margin.left, 0], [width - margin.right, height]])
      .on('zoom', (event) => {
        x = event.transform.rescaleX(xBase);
        drawContent();
        drawAxes();
        const domain = x.domain();
        const l1 = Math.max(Math.round(domain[0]), minLap);
        const l2 = Math.min(Math.round(domain[1]), maxLap);
        if (l1 !== minLap || l2 !== maxLap) {
          zoomLabel = `Laps ${l1}–${l2}`;
          zoomIndicatorSvg.text(`Laps ${l1}–${l2}`).attr('opacity', 1);
        } else {
          zoomLabel = '';
          zoomIndicatorSvg.attr('opacity', 0);
        }
      });

    svg.call(zoom).on('dblclick.zoom', () => {
      svg.transition().duration(300).call(zoom.transform, d3.zoomIdentity);
    });

    // Mouse overlay
    svg.append('rect')
      .attr('x', margin.left).attr('y', margin.top)
      .attr('width', width - margin.left - margin.right)
      .attr('height', height - margin.top - margin.bottom)
      .attr('fill', 'none')
      .attr('pointer-events', 'all')
      .on('mousemove', (event: MouseEvent) => {
        const [mx, my] = d3.pointer(event, svg.node());
        const lapNum = Math.round(x.invert(mx));
        const [dStart, dEnd] = x.domain();
        if (lapNum < Math.round(dStart) || lapNum > Math.round(dEnd)) {
          focus.style('display', 'none'); tooltipVisible = false; return;
        }

        const visibleNums = allDriverNums.filter(n => !chartState.isHidden(n));
        let closest: { num: number; gap: number; yPos: number } | null = null;
        let minDist = Infinity;

        for (const num of visibleNums) {
          const data = gapData.get(num)!;
          const point = data.find(d => d.lap === lapNum);
          if (point && point.gap <= maxGap) {
            const yPos = y(point.gap);
            const dist = Math.abs(my - yPos);
            if (dist < minDist) { minDist = dist; closest = { num, gap: point.gap, yPos }; }
          }
        }

        if (closest && minDist < 50) {
          focus.style('display', null);
          focus.select('line').attr('x1', x(lapNum)).attr('x2', x(lapNum));
          focus.select('circle').attr('cx', x(lapNum)).attr('cy', closest.yPos)
            .attr('stroke', driverColor(closest.num));
          const cw = container.clientWidth;
          tooltipX = x(lapNum) > cw * 0.65 ? x(lapNum) - 140 : x(lapNum) + 14;
          tooltipY = closest.yPos - 10;
          tooltipVisible = true;
          tooltipDriver = driverName(closest.num);
          tooltipLap = lapNum;
          tooltipColor = driverColor(closest.num);
          tooltipValue = `+${closest.gap.toFixed(1)}s`;
        } else {
          focus.style('display', 'none');
          tooltipVisible = false;
        }
      })
      .on('mouseleave', () => { focus.style('display', 'none'); tooltipVisible = false; })
      .on('click', (event: MouseEvent) => {
        const [mx, my] = d3.pointer(event, svg.node());
        const lapNum = Math.round(x.invert(mx));
        const visibleNums = allDriverNums.filter(n => !chartState.isHidden(n));
        let closest: { num: number; gap: number } | null = null;
        let minDist = Infinity;
        for (const num of visibleNums) {
          const point = gapData.get(num)!.find(d => d.lap === lapNum);
          if (point && point.gap <= maxGap) {
            const dist = Math.abs(my - y(point.gap));
            if (dist < minDist) { minDist = dist; closest = { num, gap: point.gap }; }
          }
        }
        if (closest && minDist < 50) {
          chartState.addPin({
            id: `gap-${closest.num}-${lapNum}`,
            driver: driverName(closest.num),
            driverNum: closest.num,
            lap: lapNum,
            value: `+${closest.gap.toFixed(1)}s`,
            color: driverColor(closest.num),
            chartType: 'gap',
          });
        }
      });

    svg.append('text')
      .attr('x', width / 2).attr('y', height - 4)
      .attr('fill', '#6B6B6B').attr('text-anchor', 'middle')
      .attr('font-size', '10').attr('font-family', 'JetBrains Mono, monospace')
      .text('LAP');
  }
</script>

<div class="bg-pit-surface border border-pit-border p-4">
  <div class="flex items-center gap-2 mb-3">
    <div class="w-0.5 h-3 bg-pit-accent"></div>
    <h3 class="text-[10px] heading-f1 text-pit-text-dim tracking-widest">Gap to Leader</h3>
    <div class="flex-1"></div>
    {#if zoomLabel}
      <span class="text-[9px] font-mono text-pit-accent">{zoomLabel}</span>
    {/if}
    <span class="text-[8px] text-pit-text-muted font-mono">scroll to zoom · drag to pan · dblclick reset</span>
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
      <div class="text-[#6B6B6B]">Lap {tooltipLap}</div>
      <div class="text-white font-semibold">{tooltipValue}</div>
      <div class="text-[#6B6B6B] text-[8px] mt-0.5">click to pin</div>
    </div>
    {#each pins as pin}
      <div
        class="absolute z-20 px-2 py-1 text-[9px] font-mono border rounded-sm flex items-center gap-1.5"
        style="top: 4px; left: {pins.indexOf(pin) * 130 + 70}px; background: #1E1E1E; border-color: {pin.color}; color: white;"
      >
        <div class="w-1.5 h-1.5 rounded-full" style="background: {pin.color}"></div>
        <span>{pin.driver} L{pin.lap} {pin.value}</span>
        <button
          class="text-pit-text-muted hover:text-pit-accent cursor-pointer ml-1 text-[10px] leading-none"
          onclick={() => chartState.removePin(pin.id)}
        >×</button>
      </div>
    {/each}
    <div bind:this={container} class="w-full overflow-hidden"></div>
  </div>
</div>
