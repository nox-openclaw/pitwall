<script lang="ts">
  import { chartState } from '$lib/chartState.svelte';

  let { maxLap = 60 }: { maxLap?: number } = $props();

  let startLap = $state(1);
  let endLap = $state(60);
  let dragging = $state<'start' | 'end' | null>(null);
  let track: HTMLDivElement;

  $effect(() => {
    endLap = maxLap;
    startLap = 1;
    chartState.resetLapRange(maxLap);
  });

  function pctToLap(pct: number): number {
    return Math.round(1 + pct * (maxLap - 1));
  }

  function lapToPct(lap: number): number {
    return (lap - 1) / (maxLap - 1);
  }

  function handlePointerDown(handle: 'start' | 'end') {
    return (e: PointerEvent) => {
      dragging = handle;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    };
  }

  function handlePointerMove(e: PointerEvent) {
    if (!dragging || !track) return;
    const rect = track.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const lap = pctToLap(pct);

    if (dragging === 'start') {
      startLap = Math.min(lap, endLap - 1);
    } else {
      endLap = Math.max(lap, startLap + 1);
    }
    chartState.setLapRange(startLap, endLap);
  }

  function handlePointerUp() {
    dragging = null;
  }

  function resetRange() {
    startLap = 1;
    endLap = maxLap;
    chartState.resetLapRange(maxLap);
  }
</script>

<div class="bg-pit-surface border border-pit-border p-4">
  <div class="flex items-center gap-2 mb-3">
    <div class="w-0.5 h-3 bg-pit-accent"></div>
    <h3 class="text-[10px] heading-f1 text-pit-text-dim tracking-widest">Lap Range</h3>
    <div class="flex-1"></div>
    <span class="text-[10px] font-mono text-pit-text-dim">
      Lap {startLap} – {endLap}
    </span>
    {#if startLap !== 1 || endLap !== maxLap}
      <button
        class="text-[9px] text-pit-text-muted uppercase tracking-wider hover:text-pit-accent transition-colors cursor-pointer font-mono"
        onclick={resetRange}
      >Reset</button>
    {/if}
  </div>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="relative h-8 select-none"
    bind:this={track}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
  >
    <!-- Track background -->
    <div class="absolute top-3 left-0 right-0 h-[3px] bg-pit-border rounded-full"></div>

    <!-- Active range -->
    <div
      class="absolute top-3 h-[3px] bg-pit-accent rounded-full"
      style="left: {lapToPct(startLap) * 100}%; right: {(1 - lapToPct(endLap)) * 100}%"
    ></div>

    <!-- Start handle -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="absolute top-1 w-4 h-4 -ml-2 rounded-full border-2 border-pit-accent bg-pit-surface cursor-grab active:cursor-grabbing transition-shadow hover:shadow-[0_0_6px_rgba(232,0,45,0.5)]"
      style="left: {lapToPct(startLap) * 100}%"
      onpointerdown={handlePointerDown('start')}
    ></div>

    <!-- End handle -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="absolute top-1 w-4 h-4 -ml-2 rounded-full border-2 border-pit-accent bg-pit-surface cursor-grab active:cursor-grabbing transition-shadow hover:shadow-[0_0_6px_rgba(232,0,45,0.5)]"
      style="left: {lapToPct(endLap) * 100}%"
      onpointerdown={handlePointerDown('end')}
    ></div>

    <!-- Lap markers -->
    <div class="absolute top-6 left-0 text-[8px] font-mono text-pit-text-muted">1</div>
    <div class="absolute top-6 right-0 text-[8px] font-mono text-pit-text-muted">{maxLap}</div>
  </div>
</div>
