<script lang="ts">
  import { onMount } from 'svelte';
  import type { Session, Driver, Position } from '$lib/api';
  import { getSessions, getPositions, getDrivers, uniqueDrivers } from '$lib/api';
  import { getTeamColor } from '$lib/colors';

  let sessions = $state<Session[]>([]);
  let loading = $state(true);
  let error = $state('');
  let latestSession = $state<Session | null>(null);

  // Winner info per session_key
  let winners = $state<Record<number, { name: string; lastName: string; team: string; teamColor: string }>>({});

  // Country code (3-letter from OpenF1) → ISO 2-letter for flag emoji
  const COUNTRY_ISO: Record<string, string> = {
    AUS: "AU", BRN: "BH", BHR: "BH", KSA: "SA", SAU: "SA", JPN: "JP", CHN: "CN", MIA: "US",
    ITA: 'IT', MON: 'MC', ESP: 'ES', CAN: 'CA', AUT: 'AT', GBR: 'GB',
    BEL: "BE", HUN: "HU", NLD: "NL", NED: "NL", SGP: "SG", QAT: "QA", UAE: "AE", AZE: 'AZ', USA: 'US',
    MEX: 'MX', BRA: 'BR', LVS: 'US', ABU: 'AE',
  };

  // Circuit short name → local image filename (without .png)
  const CIRCUIT_IMAGE_NAME: Record<string, string> = {
    'Melbourne': 'melbourne',
    'Bahrain': 'bahrain',
    'Jeddah': 'jeddah',
    'Suzuka': 'suzuka',
    'Shanghai': 'shanghai',
    'Miami': 'miami',
    'Imola': 'imola',
    'Monaco': 'monaco',
    'Catalunya': 'catalunya',
    'Montreal': 'montreal',
    'Spielberg': 'spielberg',
    'Silverstone': 'silverstone',
    'Budapest': 'budapest',
    'Zandvoort': 'zandvoort',
    'Monza': 'monza',
    'Singapore': 'singapore',
    'Mexico City': 'mexico_city',
    'Interlagos': 'interlagos',
    'Las Vegas': 'las_vegas',
    'Lusail': 'lusail',
    'Yas Marina': 'yas_marina',
  };

  function countryFlag(code: string): string {
    const iso = COUNTRY_ISO[code] ?? code;
    if (iso.length !== 2) return '';
    return String.fromCodePoint(
      ...iso.toUpperCase().split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65)
    );
  }

  function circuitImageUrl(circuitShortName: string): string {
    const name = CIRCUIT_IMAGE_NAME[circuitShortName];
    if (!name) return '';
    return `/circuits/${name}.png`;
  }

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

  function isCompleted(session: Session): boolean {
    return new Date(session.date_start).getTime() <= Date.now();
  }

  onMount(async () => {
    try {
      const all = await getSessions({ year: 2026 });
      sessions = all
        .filter(s => s.session_type === 'Race')
        .sort((a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime());
      // Latest completed race
      const now = Date.now();
      const past = sessions.filter(s => new Date(s.date_start).getTime() <= now);
      latestSession = past.length > 0 ? past[past.length - 1] : sessions[0] ?? null;

      // Fetch winners for completed races
      const completedSessions = sessions.filter(isCompleted);
      for (const session of completedSessions) {
        fetchWinner(session.session_key);
      }
    } catch (e) {
      error = 'Failed to load race calendar';
      console.error(e);
    } finally {
      loading = false;
    }
  });

  async function fetchWinner(sessionKey: number) {
    try {
      const [positions, drivers] = await Promise.all([
        getPositions(sessionKey),
        getDrivers(sessionKey),
      ]);
      const driverMap = new Map(uniqueDrivers(drivers).map(d => [d.driver_number, d]));
      // Find position 1 — get the latest P1 entry
      const p1 = positions
        .filter(p => p.position === 1)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
      if (p1) {
        const driver = driverMap.get(p1.driver_number);
        if (driver) {
          winners = {
            ...winners,
            [sessionKey]: {
              name: driver.name_acronym,
              lastName: driver.last_name,
              team: driver.team_name,
              teamColor: getTeamColor(driver.team_name, driver.team_colour),
            },
          };
        }
      }
    } catch {
      // Silently fail — winner just won't show
    }
  }
</script>

<div class="max-w-7xl mx-auto px-4 py-6">
  <!-- Hero / Latest Session Banner -->
  {#if latestSession}
    {@const heroImg = circuitImageUrl(latestSession.circuit_short_name)}
    {@const heroWinner = winners[latestSession.session_key]}
    <a
      href="/race/{latestSession.session_key}"
      class="block mb-8 border border-pit-border bg-pit-surface card-hover transition-all duration-200 relative overflow-hidden group"
    >
      <!-- Red accent line at top -->
      <div class="absolute top-0 left-0 right-0 h-[2px] bg-pit-accent"></div>

      <!-- Circuit layout background -->
      {#if heroImg}
        <img
          src={heroImg}
          alt=""
          class="absolute right-0 top-0 h-full w-auto opacity-[0.25] object-contain pointer-events-none select-none"
        />
      {/if}

      <div class="p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 relative z-10">
        <div>
          <div class="flex items-center gap-3 mb-2">
            <span class="text-[10px] uppercase tracking-widest text-pit-accent font-semibold data-mono">Latest Race</span>
            <span class="w-1.5 h-1.5 rounded-full bg-pit-accent pulse-live"></span>
          </div>
          <div class="flex items-center gap-4 mb-1">
            <span class="text-5xl leading-none">{countryFlag(latestSession.country_code)}</span>
            <h2 class="heading-f1 text-3xl sm:text-4xl text-pit-text">
              {latestSession.country_name} Grand Prix
            </h2>
          </div>
          <p class="text-sm text-pit-text-dim">
            {latestSession.circuit_short_name} &middot; {formatDateLong(latestSession.date_start)}
          </p>
          {#if heroWinner}
            <p class="text-xs text-pit-text-dim mt-2 flex items-center gap-1.5">
              <span class="inline-block w-2 h-2 rounded-full" style="background:{heroWinner.teamColor}"></span>
              Won by: {heroWinner.lastName} ({heroWinner.team})
            </p>
          {/if}
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
    <h1 class="heading-f1 text-xl text-pit-text">2026 Race Calendar</h1>
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
        {@const imgUrl = circuitImageUrl(session.circuit_short_name)}
        {@const winner = winners[session.session_key]}
        <a
          href="/race/{session.session_key}"
          class="group bg-pit-bg p-5 hover:bg-pit-surface transition-all duration-150 relative overflow-hidden"
        >
          <!-- Hover accent -->
          <div class="absolute left-0 top-0 bottom-0 w-0 group-hover:w-[2px] bg-pit-accent transition-all duration-150"></div>

          <!-- Circuit layout background -->
          {#if imgUrl}
            <img
              src={imgUrl}
              alt=""
              class="absolute right-0 top-0 h-full w-auto opacity-[0.20] group-hover:opacity-[0.35] object-contain pointer-events-none select-none transition-opacity duration-300"
            />
          {/if}

          <div class="relative z-10">
            <div class="flex items-start justify-between mb-3">
              <span class="text-[10px] font-mono text-pit-text-muted uppercase tracking-wider">R{String(i + 1).padStart(2, '0')}</span>
              <span class="text-[10px] text-pit-text-muted font-mono tracking-wide">{formatDate(session.date_start)}</span>
            </div>
            <div class="flex items-center gap-3 mb-1">
              <span class="text-3xl leading-none">{countryFlag(session.country_code)}</span>
              <span class="heading-f1 text-2xl text-pit-text group-hover:text-pit-accent transition-colors">{session.country_code}</span>
            </div>
            <h2 class="text-xs font-medium text-pit-text-dim mb-0.5">
              {session.country_name}
            </h2>
            <p class="text-[10px] text-pit-text-muted font-mono">{session.circuit_short_name}</p>

            {#if winner}
              <p class="text-[10px] text-pit-text-dim mt-2 flex items-center gap-1.5">
                <span class="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0" style="background:{winner.teamColor}"></span>
                Won by: {winner.lastName} ({winner.team})
              </p>
            {/if}
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>
