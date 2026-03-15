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
  // Austin and Baku intentionally omitted (no image available)
  const CIRCUIT_IMAGE: Record<string, string> = {
    'Melbourne': 'melbourne',
    'Sakhir': 'bahrain',
    'Bahrain': 'bahrain',
    'Jeddah': 'jeddah',
    'Suzuka': 'suzuka',
    'Shanghai': 'shanghai',
    'Miami': 'miami',
    'Imola': 'imola',
    'Monaco': 'monaco',
    'Barcelona': 'catalunya',
    'Catalunya': 'catalunya',
    'Montréal': 'montreal',
    'Montreal': 'montreal',
    'Spielberg': 'spielberg',
    'Silverstone': 'silverstone',
    'Budapest': 'budapest',
    'Zandvoort': 'zandvoort',
    'Monza': 'monza',
    'Singapore': 'singapore',
    'Mexico City': 'mexico_city',
    'São Paulo': 'interlagos',
    'Sao Paulo': 'interlagos',
    'Interlagos': 'interlagos',
    'Las Vegas': 'las_vegas',
    'Lusail': 'lusail',
    'Yas Island': 'yas_marina',
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

  onMount(async () => {
    try {
      const all = await getSessions({ year: 2026 });
      const sorted = all.sort((a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime());

      // Group sessions by meeting_key
      const meetingMap = new Map<number, Session[]>();
      for (const s of sorted) {
        const existing = meetingMap.get(s.meeting_key) ?? [];
        existing.push(s);
        meetingMap.set(s.meeting_key, existing);
      }

      // Build meeting list — only include meetings that have a Race session
      const meetingList: Meeting[] = [];
      let round = 0;
      for (const [meetingKey, sessionList] of meetingMap) {
        const race = sessionList.find(s => s.session_type === 'Race');
        if (!race) continue;
        round++;
        const sprint = sessionList.find(s => s.session_type === 'Sprint') ?? null;
        meetingList.push({
          meeting_key: meetingKey,
          race,
          sprint,
          hasSprint: sprint !== null,
          round,
        });
      }

      meetings = meetingList;

      // Latest completed race
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
    <span class="text-[10px] uppercase tracking-widest text-pit-text-muted data-mono">{meetings.length} Rounds</span>
  </div>

  {#if loading}
    <div class="flex items-center justify-center py-20">
      <div class="w-7 h-7 spinner-f1"></div>
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
