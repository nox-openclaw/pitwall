<script lang="ts">
  import '../app.css';
  let { children } = $props();
</script>

<svelte:head>
  <title>Pitwall - F1 Analytics</title>
</svelte:head>

<div class="min-h-screen flex flex-col">
  <nav class="border-b border-pit-border bg-pit-surface/80 backdrop-blur-md sticky top-0 z-50">
    <div class="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
      <a href="/" class="flex items-center gap-2 group">
        <div class="w-8 h-8 bg-pit-accent rounded flex items-center justify-center font-black text-white text-sm tracking-tighter">
          PW
        </div>
        <span class="text-lg font-bold tracking-tight text-pit-text group-hover:text-pit-accent transition-colors">
          PITWALL
        </span>
      </a>
      <div class="flex items-center gap-6 text-sm font-medium">
        <a href="/" class="text-pit-text-dim hover:text-pit-text transition-colors">Races</a>
        <a href="/drivers" class="text-pit-text-dim hover:text-pit-text transition-colors">Drivers</a>
      </div>
    </div>
  </nav>

  <main class="flex-1">
    {@render children()}
  </main>

  <footer class="border-t border-pit-border py-4 text-center text-xs text-pit-text-dim">
    Pitwall F1 Analytics &middot; Data from OpenF1 API
  </footer>
</div>
