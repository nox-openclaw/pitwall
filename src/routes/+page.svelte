<script lang="ts">
  import { onMount } from 'svelte';
  import type { Session } from '$lib/api';
  import { getSessions } from '$lib/api';

  let sessions = $state<Session[]>([]);
  let loading = $state(true);
  let error = $state('');
  let latestSession = $state<Session | null>(null);

  onMount(async () => {
    try {
      const all = await getSessions({ year: 2024 });
      sessions = all
        .filter(s => s.session_type === 'Race')
        .sort((a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime());
      // Latest completed race
      const now = Date.now();
      const past = sessions.filter(s => new Date(s.date_start).getTime() <= now);
      latestSession = past.length > 0 ? past[past.length - 1] : sessions[0] ?? null;
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

  function formatDateLong(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }
</script>

<div class="max-w-7xl mx-auto px-4 py-6">
  <!-- Hero / Latest Session Banner -->
  {#if latestSession}
    <a
      href="/race/{latestSession.session_key}"
      class="block mb-8 border border-pit-border bg-pit-surface card-hover transition-all duration-200 relative overflow-hidden group"
    >
      <!-- Red accent line at top -->
      <div class="absolute top-0 left-0 right-0 h-[2px] bg-pit-accent"></div>

      <div class="p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div class="flex items-center gap-3 mb-2">
            <span class="text-[10px] uppercase tracking-widest text-pit-accent font-semibold data-mono">Latest Race</span>
            <span class="w-1.5 h-1.5 rounded-full bg-pit-accent pulse-live"></span>
          </div>
          <h2 class="heading-f1 text-3xl sm:text-4xl text-pit-text mb-1">
            {latestSession.country_name} Grand Prix
          </h2>
          <p class="text-sm text-pit-text-dim">
            {latestSession.circuit_short_name} &middot; {formatDateLong(latestSession.date_start)}
          </p>
        </div>
        <div class="flex items-center gap-2 text-pit-text-dim group-hover:text-pit-accent transition-colors">
          <span class="text-xs uppercase tracking-wider font-medium">View Telemetry</span>
          <span class="text-lg">&rarr;</span>
        </div>
      </div>
    </a>
  {/if}

  <!-- Section Header -->
  <div class="flex items-center gap-3 mb-6">
    <div class="w-1 h-5 bg-pit-accent"></div>
    <h1 class="heading-f1 text-xl text-pit-text">2024 Race Calendar</h1>
    <div class="flex-1 h-px bg-pit-border"></div>
    <span class="text-[10px] uppercase tracking-widest text-pit-text-muted data-mono">{sessions.length} Rounds</span>
  </div>

  {#if loading}
    <div class="flex items-center justify-center py-20">
      <div class="w-7 h-7 spinner-f1"></div>
    </div>
  {:else if error}
    <div class="text-center py-20 text-pit-text-dim text-sm">{error}</div>
  {:else}
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-pit-border">
      {#each sessions as session, i}
        <a
          href="/race/{session.session_key}"
          class="group bg-pit-bg p-5 hover:bg-pit-surface transition-all duration-150 relative"
        >
          <!-- Hover accent -->
          <div class="absolute left-0 top-0 bottom-0 w-0 group-hover:w-[2px] bg-pit-accent transition-all duration-150"></div>

          <div class="flex items-start justify-between mb-3">
            <span class="text-[10px] font-mono text-pit-text-muted uppercase tracking-wider">R{String(i + 1).padStart(2, '0')}</span>
            <span class="text-[10px] text-pit-text-muted font-mono tracking-wide">{formatDate(session.date_start)}</span>
          </div>
          <div class="mb-1">
            <span class="heading-f1 text-2xl text-pit-text group-hover:text-pit-accent transition-colors">{session.country_code}</span>
          </div>
          <h2 class="text-xs font-medium text-pit-text-dim mb-0.5">
            {session.country_name}
          </h2>
          <p class="text-[10px] text-pit-text-muted font-mono">{session.circuit_short_name}</p>
        </a>
      {/each}
    </div>
  {/if}
</div>
