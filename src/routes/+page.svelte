<script lang="ts">
  import { onMount } from 'svelte';
  import type { Session } from '$lib/api';
  import { getSessions } from '$lib/api';

  let sessions = $state<Session[]>([]);
  let loading = $state(true);
  let error = $state('');

  onMount(async () => {
    try {
      const all = await getSessions({ year: 2024 });
      sessions = all
        .filter(s => s.session_type === 'Race')
        .sort((a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime());
    } catch (e) {
      error = 'Failed to load race calendar';
      console.error(e);
    } finally {
      loading = false;
    }
  });

  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  }
</script>

<div class="max-w-7xl mx-auto px-4 py-8">
  <div class="mb-8">
    <h1 class="text-3xl font-black tracking-tight mb-1">Race Calendar</h1>
    <p class="text-pit-text-dim text-sm">2024 FIA Formula 1 World Championship</p>
  </div>

  {#if loading}
    <div class="flex items-center justify-center py-20">
      <div class="w-8 h-8 border-2 border-pit-accent border-t-transparent rounded-full animate-spin"></div>
    </div>
  {:else if error}
    <div class="text-center py-20 text-pit-text-dim">{error}</div>
  {:else}
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {#each sessions as session, i}
        <a
          href="/race/{session.session_key}"
          class="group bg-pit-surface border border-pit-border rounded-lg p-5 hover:border-pit-accent/50 hover:bg-pit-surface-2 transition-all duration-200"
        >
          <div class="flex items-start justify-between mb-3">
            <span class="text-xs font-mono text-pit-text-dim">R{String(i + 1).padStart(2, '0')}</span>
            <span class="text-xs text-pit-text-dim font-mono">{formatDate(session.date_start)}</span>
          </div>
          <div class="mb-1">
            <span class="text-2xl font-bold mr-2">{session.country_code}</span>
          </div>
          <h2 class="text-sm font-semibold text-pit-text mb-1 group-hover:text-pit-accent transition-colors">
            {session.country_name}
          </h2>
          <p class="text-xs text-pit-text-dim">{session.circuit_short_name}</p>
        </a>
      {/each}
    </div>
  {/if}
</div>
