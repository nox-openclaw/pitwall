<script lang="ts">
  import '../app.css';
  import { page } from '$app/stores';
  let { children } = $props();

  let currentPath = $derived($page.url.pathname);
</script>

<svelte:head>
  <title>Pitwall - F1 Analytics</title>
</svelte:head>

<div class="min-h-screen flex flex-col">
  <nav class="border-b border-pit-border bg-pit-bg/95 backdrop-blur-sm sticky top-0 z-50">
    <div class="max-w-7xl mx-auto px-4 h-12 flex items-center justify-between">
      <a href="/" class="flex items-center gap-2.5 group">
        <div class="relative w-9 h-9 bg-pit-accent flex items-center justify-center glow-red">
          <span class="text-white text-sm font-black tracking-tighter" style="font-family: var(--font-heading);">P1</span>
        </div>
        <span class="heading-f1 text-lg text-pit-text group-hover:text-pit-accent transition-colors duration-150">
          PITWALL
        </span>
      </a>

      <div class="flex items-center gap-1 text-xs font-medium uppercase tracking-wider">
        <a
          href="/"
          class="px-3 py-1.5 transition-colors duration-150 {currentPath === '/' ? 'text-pit-accent border-b-2 border-pit-accent' : 'text-pit-text-dim hover:text-pit-text'}"
        >Races</a>
        <a
          href="/drivers"
          class="px-3 py-1.5 transition-colors duration-150 {currentPath === '/drivers' ? 'text-pit-accent border-b-2 border-pit-accent' : 'text-pit-text-dim hover:text-pit-text'}"
        >Drivers</a>
      </div>
    </div>
  </nav>

  <main class="flex-1">
    {@render children()}
  </main>

  <footer class="border-t border-pit-border py-3 text-center">
    <span class="text-[10px] uppercase tracking-widest text-pit-text-muted data-mono">
      Pitwall F1 Analytics &middot; Data via OpenF1
    </span>
  </footer>
</div>
