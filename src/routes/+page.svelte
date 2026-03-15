<script lang="ts">
  import { onMount } from 'svelte';
  import type { Session, Driver, Position } from '$lib/api';
  import { getSessions, getPositions, getDrivers, uniqueDrivers } from '$lib/api';
  import { getTeamColor } from '$lib/colors';

  interface Meeting {
    meeting_key: number;
    race: Session;
    sprint: Session | null;
    hasSprint: boolean;
    round: number;
  }

  let meetings = $state<Meeting[]>([]);
  let loading = $state(true);
  let revalidating = $state(false);
  let error = $state('');
  let latestMeeting = $state<Meeting | null>(null);

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
  // Includes all known OpenF1 variations and common aliases
  const CIRCUIT_IMAGE: Record<string, string> = {
    // Australia
    'Melbourne': 'melbourne',
    'Albert Park': 'melbourne',
    // Bahrain
    'Sakhir': 'bahrain',
    'Bahrain': 'bahrain',
    // Saudi Arabia
    'Jeddah': 'jeddah',
    // Japan
    'Suzuka': 'suzuka',
    // China
    'Shanghai': 'shanghai',
    // USA - Miami
    'Miami': 'miami',
    // Italy - Imola
    'Imola': 'imola',
    // Monaco
    'Monaco': 'monaco',
    'Monte Carlo': 'monaco',
    // Spain
    'Barcelona': 'catalunya',
    'Catalunya': 'catalunya',
    'Montmeló': 'catalunya',
    'Montmelo': 'catalunya',
    'Madrid': 'madrid',
    // Canada
    'Montréal': 'montreal',
    'Montreal': 'montreal',
    // Austria
    'Spielberg': 'spielberg',
    'Red Bull Ring': 'spielberg',
    // UK
    'Silverstone': 'silverstone',
    // Hungary
    'Budapest': 'budapest',
    'Hungaroring': 'budapest',
    // Belgium
    'Spa-Francorchamps': 'spa',
    'Spa': 'spa',
    // Netherlands
    'Zandvoort': 'zandvoort',
    // Italy - Monza
    'Monza': 'monza',
    // Azerbaijan
    'Baku': 'baku',
    // Singapore
    'Singapore': 'singapore',
    'Marina Bay': 'singapore',
    // USA - Austin
    'Austin': 'austin',
    'Madring': 'madring',
    'COTA': 'austin',
    // Mexico
    'Mexico City': 'mexico_city',
    'México': 'mexico_city',
    // Brazil
    'São Paulo': 'interlagos',
    'Sao Paulo': 'interlagos',
    'Interlagos': 'interlagos',
    // USA - Las Vegas
    'Las Vegas': 'las_vegas',
    // Qatar
    'Lusail': 'lusail',
    'Losail': 'lusail',
    // Abu Dhabi
    'Yas Island': 'yas_marina',
    'Yas Marina': 'yas_marina',
    'Yas Marina Circuit': 'yas_marina',
    'Spa-Francorchamps': 'spa',
    'Hungaroring': 'budapest',
    'Baku': 'baku',
    'Austin': 'austin',
    'Madring': 'madring',
    'Abu Dhabi': 'yas_marina',
  };

  function countryFlag(code: string): string {
    const iso = COUNTRY_ISO[code] ?? code;
    if (iso.length !== 2) return '';
    return String.fromCodePoint(
      ...iso.toUpperCase().split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65)
    );
  }

  function circuitImageUrl(circuitShortName: string): string {
    const name = CIRCUIT_IMAGE[circuitShortName];
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

  // --- SWR Cache helpers ---
  const SESSIONS_CACHE_KEY = 'pitwall_sessions_2026';
  const SESSIONS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

  interface CacheEntry<T> {
    data: T;
    timestamp: number;
  }

  function cacheGet<T>(key: string, ttl: number): T | null {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const entry: CacheEntry<T> = JSON.parse(raw);
      if (Date.now() - entry.timestamp > ttl) return null;
      return entry.data;
    } catch {
      return null;
    }
  }

  function cacheSet<T>(key: string, data: T): void {
    try {
      const entry: CacheEntry<T> = { data, timestamp: Date.now() };
      localStorage.setItem(key, JSON.stringify(entry));
    } catch {
      // localStorage full or unavailable
    }
  }

  function processSessions(all: Session[]): Meeting[] {
    const sorted = all.sort((a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime());

    const meetingMap = new Map<number, Session[]>();
    for (const s of sorted) {
      const existing = meetingMap.get(s.meeting_key) ?? [];
      existing.push(s);
      meetingMap.set(s.meeting_key, existing);
    }

    const meetingList: Meeting[] = [];
    let round = 0;
    for (const [meetingKey, sessionList] of meetingMap) {
      const race = sessionList.find(s => s.session_type === 'Race' && s.session_name === 'Race');
      if (!race) continue;
      round++;
      const sprint = sessionList.find(s => s.session_name === 'Sprint') ?? null;
      meetingList.push({
        meeting_key: meetingKey,
        race,
        sprint,
        hasSprint: sprint !== null,
        round,
      });
    }
    return meetingList;
  }

  function applyMeetings(meetingList: Meeting[]) {
    meetings = meetingList;

    const now = Date.now();
    const past = meetings.filter(m => new Date(m.race.date_start).getTime() <= now);
    latestMeeting = past.length > 0 ? past[past.length - 1] : meetings[0] ?? null;

    // Fetch winners for completed races
    for (const m of meetings) {
      if (isCompleted(m.race)) {
        fetchWinner(m.race.session_key);
      }
      if (m.sprint && isCompleted(m.sprint)) {
        fetchWinner(m.sprint.session_key);
      }
    }
  }

  onMount(async () => {
    // SWR: try cached data first for instant render
    const cached = cacheGet<Session[]>(SESSIONS_CACHE_KEY, SESSIONS_CACHE_TTL);
    if (cached) {
      const meetingList = processSessions(cached);
      applyMeetings(meetingList);
      loading = false;

      // Background revalidate
      revalidating = true;
      try {
        const fresh = await getSessions({ year: 2026 });
        cacheSet(SESSIONS_CACHE_KEY, fresh);
        const freshMeetings = processSessions(fresh);
        applyMeetings(freshMeetings);
      } catch (e) {
        console.error('Background revalidation failed:', e);
      } finally {
        revalidating = false;
      }
    } else {
      // No cache — fetch and show loading skeleton
      try {
        const all = await getSessions({ year: 2026 });
        cacheSet(SESSIONS_CACHE_KEY, all);
        const meetingList = processSessions(all);
        applyMeetings(meetingList);
      } catch (e) {
        error = 'Failed to load race calendar';
        console.error(e);
      } finally {
        loading = false;
      }
    }
  });

  async function fetchWinner(sessionKey: number) {
    try {
      const [positions, drivers] = await Promise.all([
        getPositions(sessionKey),
        getDrivers(sessionKey),
      ]);
      const driverMap = new Map(uniqueDrivers(drivers).map(d => [d.driver_number, d]));
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
  {#if latestMeeting}
    {@const heroImg = circuitImageUrl(latestMeeting.race.circuit_short_name)}
    {@const heroWinner = winners[latestMeeting.race.session_key]}
    <a
      href="/race/{latestMeeting.race.session_key}"
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
            <span class="text-[10px] font-mono text-pit-text-muted uppercase tracking-wider">R{String(latestMeeting.round).padStart(2, '0')}</span>
            {#if latestMeeting.hasSprint}
              <span class="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-sm bg-amber-500/20 text-amber-400 border border-amber-500/30">Sprint</span>
            {/if}
          </div>
          <div class="flex items-center gap-4 mb-1">
            <span class="text-5xl leading-none">{countryFlag(latestMeeting.race.country_code)}</span>
            <h2 class="heading-f1 text-3xl sm:text-4xl text-pit-text">
              {latestMeeting.race.country_name} Grand Prix
            </h2>
          </div>
          <p class="text-sm text-pit-text-dim">
            {latestMeeting.race.circuit_short_name} &middot; {formatDateLong(latestMeeting.race.date_start)}
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
    {#if revalidating}
      <span class="w-2 h-2 rounded-full bg-pit-accent animate-spin-slow opacity-70" title="Refreshing data"></span>
    {/if}
    <span class="text-[10px] uppercase tracking-widest text-pit-text-muted data-mono">{meetings.length} Rounds</span>
  </div>

  {#if loading}
    <!-- Skeleton loading: 12 placeholder cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-pit-border">
      {#each Array(12) as _}
        <div class="bg-pit-bg p-5 relative overflow-hidden">
          <div class="relative z-10">
            <!-- Top row: round badge + date -->
            <div class="flex items-start justify-between mb-3">
              <div class="flex items-center gap-2">
                <div class="h-3 w-6 bg-pit-surface animate-pulse rounded-sm"></div>
                <div class="h-4 w-10 bg-pit-surface animate-pulse rounded-sm"></div>
              </div>
              <div class="h-3 w-12 bg-pit-surface animate-pulse rounded-sm"></div>
            </div>
            <!-- Flag + country code -->
            <div class="flex items-center gap-3 mb-1">
              <div class="w-8 h-8 bg-pit-surface animate-pulse rounded"></div>
              <div class="h-6 w-14 bg-pit-surface animate-pulse rounded-sm"></div>
            </div>
            <!-- Country name -->
            <div class="h-3 w-28 bg-pit-surface animate-pulse rounded-sm mb-1"></div>
            <!-- Circuit name -->
            <div class="h-2.5 w-20 bg-pit-surface animate-pulse rounded-sm"></div>
            <!-- Winner line -->
            <div class="h-2.5 w-32 bg-pit-surface animate-pulse rounded-sm mt-3"></div>
          </div>
          <!-- Skeleton circuit image area -->
          <div class="absolute right-2 top-2 w-20 h-[85%] bg-pit-surface/50 animate-pulse rounded"></div>
        </div>
      {/each}
    </div>
  {:else if error}
    <div class="text-center py-20 text-pit-text-dim text-sm">{error}</div>
  {:else}
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-pit-border">
      {#each meetings as meeting}
        {@const imgUrl = circuitImageUrl(meeting.race.circuit_short_name)}
        {@const raceWinner = winners[meeting.race.session_key]}
        {@const sprintWinner = meeting.sprint ? winners[meeting.sprint.session_key] : null}
        <a
          href="/race/{meeting.race.session_key}"
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
              <div class="flex items-center gap-2">
                <span class="text-[10px] font-mono text-pit-text-muted uppercase tracking-wider">R{String(meeting.round).padStart(2, '0')}</span>
                <span class="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-sm bg-red-500/20 text-red-400 border border-red-500/30">Race</span>
                {#if meeting.hasSprint}
                  <span class="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-sm bg-amber-500/20 text-amber-400 border border-amber-500/30">Sprint</span>
                {/if}
              </div>
              <span class="text-[10px] text-pit-text-muted font-mono tracking-wide">{formatDate(meeting.race.date_start)}</span>
            </div>
            <div class="flex items-center gap-3 mb-1">
              <span class="text-3xl leading-none">{countryFlag(meeting.race.country_code)}</span>
              <span class="heading-f1 text-2xl text-pit-text group-hover:text-pit-accent transition-colors">{meeting.race.country_code}</span>
            </div>
            <h2 class="text-xs font-medium text-pit-text-dim mb-0.5">
              {meeting.race.country_name}
            </h2>
            <p class="text-[10px] text-pit-text-muted font-mono">{meeting.race.circuit_short_name}</p>

            {#if raceWinner}
              <p class="text-[10px] text-pit-text-dim mt-2 flex items-center gap-1.5">
                <span class="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0" style="background:{raceWinner.teamColor}"></span>
                Won by: {raceWinner.lastName} ({raceWinner.team})
              </p>
            {/if}
            {#if sprintWinner}
              <p class="text-[10px] text-pit-text-dim mt-1 flex items-center gap-1.5">
                <span class="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0" style="background:{sprintWinner.teamColor}"></span>
                Sprint: {sprintWinner.lastName} ({sprintWinner.team})
              </p>
            {/if}
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>

<style>
  @keyframes spin-slow {
    to { transform: rotate(360deg); }
  }
  .animate-spin-slow {
    animation: spin-slow 1.5s linear infinite;
  }
</style>
