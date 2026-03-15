<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { dndzone } from 'svelte-dnd-action';
	import { getSessions, getDrivers, getPositions, uniqueDrivers } from '$lib/api';
	import type { Session, Driver, Position } from '$lib/api';
	import { getTeamColor } from '$lib/colors';
	import {
		predictRace,
		type PredictedPosition,
		type StagePrediction,
	} from '$lib/predictions';

	let sessionKey = $derived(Number($page.params.session_key));

	// --- State ---
	let session = $state<Session | null>(null);
	let drivers = $state<Driver[]>([]);
	let loading = $state(true);
	let error = $state('');

	// Drag-and-drop list items
	interface DndDriver {
		id: number;
		driver: Driver;
	}
	let dndItems = $state<DndDriver[]>([]);
	const flipDurationMs = 200;

	// Prediction lock state
	let locked = $state(false);
	let lockTimestamp = $state<number>(0);

	// Race started?
	let raceStarted = $derived(() => {
		if (!session?.date_start) return false;
		return new Date(session.date_start).getTime() <= Date.now();
	});

	// Model prediction
	let modelPrediction = $state<StagePrediction | null>(null);
	let modelLoading = $state(false);
	let showModel = $state(false);

	// Actual results
	let actualResults = $state<Map<number, number>>(new Map());
	let resultsLoaded = $state(false);

	// Nickname
	let nickname = $state('');

	// Scoring
	interface ScoreResult {
		userScore: number;
		modelScore: number;
		userExact: number;
		modelExact: number;
		userHalf: number;
		modelHalf: number;
	}

	let scoreResult = $derived.by((): ScoreResult | null => {
		if (!resultsLoaded || actualResults.size === 0 || !locked) return null;

		const savedPrediction = loadPrediction();
		if (!savedPrediction) return null;

		const userScore = calculateScore(savedPrediction);
		const modelOrder = modelPrediction
			? modelPrediction.predictions.map((p) => p.driver_number)
			: [];
		const modelScore = modelOrder.length > 0 ? calculateScore(modelOrder) : { total: 0, exact: 0, half: 0 };

		return {
			userScore: userScore.total,
			modelScore: modelScore.total,
			userExact: userScore.exact,
			modelExact: modelScore.exact,
			userHalf: userScore.half,
			modelHalf: modelScore.half,
		};
	});

	function calculateScore(order: number[]): { total: number; exact: number; half: number } {
		let exact = 0;
		let half = 0;
		for (let i = 0; i < order.length; i++) {
			const driverNum = order[i];
			const actualPos = actualResults.get(driverNum);
			if (actualPos === undefined) continue;

			// Exact position match
			if (actualPos === i + 1) {
				exact++;
			}
			// Correct half (top 10 vs bottom 10)
			const predictedHalf = i < 10 ? 'top' : 'bottom';
			const actualHalf = actualPos <= 10 ? 'top' : 'bottom';
			if (predictedHalf === actualHalf) {
				half++;
			}
		}
		return { total: exact * 3 + half * 1, exact, half };
	}

	// localStorage helpers
	function storageKey(): string {
		return `pitwall_prediction_${sessionKey}`;
	}

	function savePrediction() {
		const order = dndItems.map((d) => d.id);
		const data = { order, timestamp: Date.now(), nickname };
		localStorage.setItem(storageKey(), JSON.stringify(data));
	}

	function loadPrediction(): number[] | null {
		try {
			const raw = localStorage.getItem(storageKey());
			if (!raw) return null;
			const data = JSON.parse(raw);
			return data.order ?? null;
		} catch {
			return null;
		}
	}

	function loadNickname(): string {
		try {
			return localStorage.getItem('pitwall_nickname') ?? '';
		} catch {
			return '';
		}
	}

	function saveNickname(name: string) {
		localStorage.setItem('pitwall_nickname', name);
	}

	function lockPrediction() {
		locked = true;
		lockTimestamp = Date.now();
		savePrediction();
	}

	// DnD handler
	function handleDndConsider(e: CustomEvent<{ items: DndDriver[] }>) {
		dndItems = e.detail.items;
	}

	function handleDndFinalize(e: CustomEvent<{ items: DndDriver[] }>) {
		dndItems = e.detail.items;
	}

	// Load model prediction
	async function loadModelPrediction() {
		if (modelPrediction || modelLoading || !session) return;
		modelLoading = true;
		try {
			// Build grid positions from driver order
			const gridPositions = new Map<number, number>();
			drivers.forEach((d, i) => gridPositions.set(d.driver_number, i + 1));

			// Try to get qualifying positions for better grid
			const allSessions = await getSessions({
				circuit_short_name: session.circuit_short_name,
				year: session.year,
			});
			const qualiSession = allSessions.find(
				(s) => s.session_type === 'Qualifying' || s.session_name?.includes('Qualifying')
			);
			if (qualiSession) {
				const positions = await getPositions(qualiSession.session_key);
				for (const p of positions) {
					gridPositions.set(p.driver_number, p.position);
				}
			}

			modelPrediction = await predictRace(
				session.circuit_short_name.toLowerCase(),
				session.year,
				drivers,
				gridPositions
			);
		} catch (e) {
			console.error('Failed to load model prediction:', e);
		}
		modelLoading = false;
	}

	// Load actual race results
	async function loadActualResults() {
		if (!session) return;
		try {
			const positions = await getPositions(sessionKey);
			if (positions.length === 0) return;

			// Get the last position entry per driver (final result)
			const finalPositions = new Map<number, number>();
			for (const p of positions) {
				finalPositions.set(p.driver_number, p.position);
			}
			if (finalPositions.size > 0) {
				actualResults = finalPositions;
				resultsLoaded = true;
			}
		} catch (e) {
			console.error('Failed to load results:', e);
		}
	}

	onMount(async () => {
		nickname = loadNickname();

		try {
			const [sessionsData, driversData] = await Promise.all([
				getSessions({ session_key: sessionKey }),
				getDrivers(sessionKey),
			]);

			session = sessionsData[0] ?? null;
			drivers = uniqueDrivers(driversData);

			// Check for existing locked prediction
			const saved = loadPrediction();
			if (saved) {
				locked = true;
				// Restore order from saved prediction
				const driverMap = new Map(drivers.map((d) => [d.driver_number, d]));
				const ordered: DndDriver[] = [];
				for (const num of saved) {
					const driver = driverMap.get(num);
					if (driver) {
						ordered.push({ id: num, driver });
						driverMap.delete(num);
					}
				}
				// Add any drivers not in saved (new entries)
				for (const [num, driver] of driverMap) {
					ordered.push({ id: num, driver });
				}
				dndItems = ordered;
			} else {
				// Default order: just the driver list as-is
				dndItems = drivers.map((d) => ({ id: d.driver_number, driver: d }));
			}

			// Load actual results if race might be done
			if (session && new Date(session.date_start).getTime() <= Date.now()) {
				await loadActualResults();
			}
		} catch (e) {
			error = 'Failed to load session data.';
			console.error(e);
		} finally {
			loading = false;
		}
	});

	// Save nickname reactively
	$effect(() => {
		if (nickname) saveNickname(nickname);
	});
</script>

<svelte:head>
	<title>Beat the Algorithm — Pitwall</title>
</svelte:head>

<div class="max-w-7xl mx-auto px-4 py-6">
	<div class="mb-4">
		{#if session}
			<a
				href="/race/{sessionKey}"
				class="text-pit-text-muted text-[10px] uppercase tracking-widest hover:text-pit-accent transition-colors data-mono"
			>&larr; Back to race</a>
		{/if}
	</div>

	{#if loading}
		<div class="flex items-center justify-center py-20 gap-3">
			<div class="w-7 h-7 spinner-f1"></div>
			<span class="text-pit-text-muted text-xs uppercase tracking-wider">Loading session...</span>
		</div>
	{:else if error}
		<div class="text-center py-20">
			<p class="text-pit-text-dim text-sm">{error}</p>
			<a href="/" class="text-pit-accent text-xs mt-4 inline-block hover:underline uppercase tracking-wider">Back to calendar</a>
		</div>
	{:else if session}
		<!-- Header -->
		<div class="flex items-center gap-3 mb-2">
			<div class="w-1 h-8 bg-pit-accent glow-red-subtle"></div>
			<h1 class="heading-f1 text-2xl text-pit-text">BEAT THE ALGORITHM</h1>
			<span class="text-[10px] uppercase tracking-widest text-pit-purple data-mono ml-2 border border-pit-purple/30 px-2 py-0.5">
				GAME
			</span>
		</div>
		<p class="text-xs text-pit-text-muted mb-6 ml-4">
			{session.country_name} Grand Prix &middot; {session.year}
			— Drag drivers to predict the finishing order, then see if you beat Pitwall's model.
		</p>

		<!-- Score banner (after race with results) -->
		{#if scoreResult}
			<div class="mb-6 border p-5 {scoreResult.userScore >= scoreResult.modelScore ? 'border-pit-green bg-pit-green/5' : 'border-pit-accent bg-pit-accent/5'}">
				<div class="flex items-center gap-3 mb-4">
					<span class="heading-f1 text-lg {scoreResult.userScore >= scoreResult.modelScore ? 'text-pit-green' : 'text-pit-accent'}">
						{scoreResult.userScore >= scoreResult.modelScore ? 'YOU BEAT THE ALGORITHM!' : 'PITWALL WINS THIS ONE'}
					</span>
				</div>
				<div class="grid grid-cols-2 gap-4">
					<div class="bg-pit-surface border border-pit-border p-4">
						<p class="text-[10px] uppercase tracking-widest text-pit-text-muted mb-1">Your Score</p>
						<p class="text-3xl font-black data-mono text-pit-text">{scoreResult.userScore}</p>
						<p class="text-[10px] text-pit-text-muted data-mono mt-1">
							{scoreResult.userExact} exact (x3) &middot; {scoreResult.userHalf} correct half (x1)
						</p>
					</div>
					<div class="bg-pit-surface border border-pit-border p-4">
						<p class="text-[10px] uppercase tracking-widest text-pit-text-muted mb-1">Pitwall Model</p>
						<p class="text-3xl font-black data-mono text-pit-text">{scoreResult.modelScore}</p>
						<p class="text-[10px] text-pit-text-muted data-mono mt-1">
							{scoreResult.modelExact} exact (x3) &middot; {scoreResult.modelHalf} correct half (x1)
						</p>
					</div>
				</div>
			</div>
		{/if}

		<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
			<!-- Left: User prediction area -->
			<div class="lg:col-span-2">
				<div class="flex items-center gap-2 mb-4">
					<div class="w-0.5 h-5 bg-pit-accent"></div>
					<h2 class="heading-f1 text-sm text-pit-text-dim">
						{#if locked}YOUR PREDICTION{:else}DRAG TO PREDICT{/if}
					</h2>
					{#if locked}
						<span class="text-[10px] text-pit-green data-mono ml-2 border border-pit-green/30 px-2 py-0.5 uppercase tracking-widest">
							Locked In
						</span>
					{/if}
				</div>

				{#if !locked && !raceStarted()}
					<p class="text-[10px] text-pit-text-muted mb-3 data-mono uppercase tracking-widest">
						Drag drivers into your predicted finishing order &middot; P1 at top
					</p>
				{/if}

				<!-- Driver list (drag-and-drop or locked) -->
				{#if !locked && !raceStarted()}
					<div
						class="space-y-1"
						use:dndzone={{ items: dndItems, flipDurationMs, dropTargetStyle: { outline: '1px solid rgba(232, 0, 45, 0.3)' } }}
						onconsider={handleDndConsider}
						onfinalize={handleDndFinalize}
					>
						{#each dndItems as item, i (item.id)}
							{@const teamColor = getTeamColor(item.driver.team_name, item.driver.team_colour)}
							<div class="flex items-center gap-3 bg-pit-surface border border-pit-border px-3 py-2 cursor-grab active:cursor-grabbing hover:border-pit-accent/30 transition-colors select-none">
								<!-- Drag handle -->
								<div class="text-pit-text-muted shrink-0">
									<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
										<circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
										<circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
										<circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
									</svg>
								</div>

								<!-- Position -->
								<div class="w-10 text-right shrink-0">
									<span class="data-mono text-lg font-black {i < 3 ? 'text-pit-accent' : 'text-pit-text'}">
										P{i + 1}
									</span>
								</div>

								<!-- Team color bar -->
								<div class="w-1 h-8 shrink-0" style="background-color: {teamColor}"></div>

								<!-- Driver info -->
								<div class="flex-1 min-w-0 flex items-center gap-2">
									<div
										class="w-7 h-7 flex items-center justify-center text-[10px] font-bold text-white shrink-0 data-mono"
										style="background-color: {teamColor}"
									>
										{item.driver.driver_number}
									</div>
									<span class="text-sm font-semibold text-pit-text">
										{item.driver.name_acronym}
									</span>
									<span class="text-[10px] text-pit-text-muted truncate hidden sm:inline">
										{item.driver.full_name}
									</span>
								</div>

								<!-- Team name -->
								<span class="text-[10px] text-pit-text-muted truncate hidden md:inline shrink-0 max-w-[120px]">
									{item.driver.team_name}
								</span>
							</div>
						{/each}
					</div>

					<!-- Lock in button -->
					<div class="mt-6">
						<button
							onclick={lockPrediction}
							class="w-full py-3 bg-pit-accent text-white font-bold uppercase tracking-widest text-sm hover:bg-pit-accent/90 transition-colors glow-red cursor-pointer"
						>
							Lock In Prediction
						</button>
						<p class="text-[10px] text-pit-text-muted text-center mt-2 data-mono">
							You can only lock in before the race starts
						</p>
					</div>
				{:else}
					<!-- Locked or race started view -->
					<div class="space-y-1">
						{#each dndItems as item, i (item.id)}
							{@const teamColor = getTeamColor(item.driver.team_name, item.driver.team_colour)}
							{@const actualPos = actualResults.get(item.id)}
							{@const isExact = actualPos === i + 1}
							{@const predictedHalf = i < 10 ? 'top' : 'bottom'}
							{@const actualHalf = actualPos !== undefined ? (actualPos <= 10 ? 'top' : 'bottom') : null}
							{@const isCorrectHalf = actualHalf !== null && predictedHalf === actualHalf}
							<div class="flex items-center gap-3 bg-pit-surface border px-3 py-2 transition-colors {isExact ? 'border-pit-green/50 bg-pit-green/5' : isCorrectHalf ? 'border-pit-yellow/20' : 'border-pit-border'}">
								<!-- Position -->
								<div class="w-10 text-right shrink-0">
									<span class="data-mono text-lg font-black {i < 3 ? 'text-pit-accent' : 'text-pit-text'}">
										P{i + 1}
									</span>
								</div>

								<!-- Team color bar -->
								<div class="w-1 h-8 shrink-0" style="background-color: {teamColor}"></div>

								<!-- Driver info -->
								<div class="flex-1 min-w-0 flex items-center gap-2">
									<div
										class="w-7 h-7 flex items-center justify-center text-[10px] font-bold text-white shrink-0 data-mono"
										style="background-color: {teamColor}"
									>
										{item.driver.driver_number}
									</div>
									<span class="text-sm font-semibold text-pit-text">
										{item.driver.name_acronym}
									</span>
									<span class="text-[10px] text-pit-text-muted truncate hidden sm:inline">
										{item.driver.full_name}
									</span>
								</div>

								<!-- Actual position (if available) -->
								{#if actualPos !== undefined}
									<div class="flex items-center gap-2 shrink-0">
										{#if isExact}
											<span class="text-[9px] uppercase tracking-widest text-pit-green data-mono font-bold">EXACT</span>
										{:else if isCorrectHalf}
											<span class="text-[9px] uppercase tracking-widest text-pit-yellow data-mono">HALF</span>
										{/if}
										<span class="data-mono text-xs text-pit-text-muted">
											Actual: P{actualPos}
										</span>
									</div>
								{/if}
							</div>
						{/each}
					</div>

					{#if locked && !resultsLoaded}
						<div class="mt-4 bg-pit-surface border border-pit-green/30 p-4 text-center">
							<p class="text-pit-green text-sm font-bold uppercase tracking-widest">Your prediction is locked in!</p>
							<p class="text-[10px] text-pit-text-muted mt-1 data-mono">
								Results will appear once the race finishes
							</p>
						</div>
					{/if}

					{#if !locked && raceStarted()}
						<div class="mt-4 bg-pit-surface border border-pit-accent/30 p-4 text-center">
							<p class="text-pit-accent text-sm font-bold uppercase tracking-widest">Race has started</p>
							<p class="text-[10px] text-pit-text-muted mt-1 data-mono">
								Predictions are no longer accepted for this session
							</p>
						</div>
					{/if}
				{/if}

				<!-- Nickname input -->
				<div class="mt-6 bg-pit-surface border border-pit-border p-4">
					<div class="flex items-center gap-2 mb-2">
						<div class="w-0.5 h-4 bg-pit-purple"></div>
						<h3 class="heading-f1 text-xs text-pit-text-dim">LEADERBOARD NICKNAME</h3>
						<span class="text-[9px] text-pit-text-muted data-mono uppercase tracking-widest">Coming soon</span>
					</div>
					<input
						type="text"
						bind:value={nickname}
						placeholder="Enter nickname..."
						maxlength="20"
						class="w-full bg-pit-bg border border-pit-border text-pit-text px-3 py-2 text-sm data-mono focus:border-pit-accent focus:outline-none placeholder:text-pit-text-muted/50"
					/>
				</div>
			</div>

			<!-- Right: Model prediction sidebar -->
			<div class="space-y-6">
				<!-- Model prediction toggle -->
				<div class="bg-pit-surface border border-pit-border p-4">
					<div class="flex items-center gap-2 mb-3">
						<div class="w-0.5 h-4 bg-pit-accent"></div>
						<h3 class="heading-f1 text-xs text-pit-text-dim">PITWALL MODEL</h3>
					</div>

					{#if !showModel}
						<button
							onclick={() => { showModel = true; loadModelPrediction(); }}
							class="w-full py-2.5 border border-pit-border text-pit-text-dim text-xs font-bold uppercase tracking-widest hover:border-pit-accent/30 hover:text-pit-text transition-colors cursor-pointer"
						>
							{modelLoading ? 'Loading...' : 'Show Model Prediction'}
						</button>
					{:else if modelLoading}
						<div class="flex items-center justify-center py-8">
							<div class="spinner-f1 w-6 h-6"></div>
						</div>
					{:else if modelPrediction}
						<button
							onclick={() => { showModel = false; }}
							class="w-full py-1.5 mb-3 text-[10px] uppercase tracking-widest text-pit-text-muted hover:text-pit-text transition-colors cursor-pointer"
						>
							Hide prediction
						</button>
						<div class="space-y-0.5 max-h-[600px] overflow-y-auto">
							{#each modelPrediction.predictions as pred, i}
								{@const teamColor = pred.driver ? getTeamColor(pred.driver.team_name, pred.driver.team_colour) : '#888'}
								{@const actualPos = actualResults.get(pred.driver_number)}
								{@const isExact = actualPos === pred.predicted_position}
								<div class="flex items-center gap-2 px-2 py-1.5 {isExact ? 'bg-pit-green/5' : ''} text-sm">
									<span class="data-mono text-xs font-bold w-7 text-right {i < 3 ? 'text-pit-accent' : 'text-pit-text-muted'}">
										P{pred.predicted_position}
									</span>
									<div class="w-0.5 h-4 shrink-0" style="background-color: {teamColor}"></div>
									<span class="text-pit-text text-xs font-semibold">
										{pred.driver?.name_acronym ?? `#${pred.driver_number}`}
									</span>
									{#if actualPos !== undefined}
										<span class="text-[9px] text-pit-text-muted data-mono ml-auto">
											P{actualPos}
										</span>
									{/if}
								</div>
							{/each}
						</div>

						{#if modelPrediction.model_notes.length > 0}
							<div class="mt-3 pt-3 border-t border-pit-border space-y-1">
								{#each modelPrediction.model_notes.slice(0, 3) as note}
									<div class="flex items-start gap-1.5 text-[10px] text-pit-text-muted data-mono">
										<span class="text-pit-accent mt-0.5">›</span>
										<span>{note}</span>
									</div>
								{/each}
							</div>
						{/if}
					{/if}
				</div>

				<!-- Scoring rules -->
				<div class="bg-pit-surface border border-pit-border p-4">
					<div class="flex items-center gap-2 mb-3">
						<div class="w-0.5 h-4 bg-pit-yellow"></div>
						<h3 class="heading-f1 text-xs text-pit-text-dim">SCORING</h3>
					</div>
					<div class="space-y-2 text-[11px] data-mono">
						<div class="flex justify-between">
							<span class="text-pit-text-muted">Exact position</span>
							<span class="text-pit-green font-bold">+3 pts</span>
						</div>
						<div class="flex justify-between">
							<span class="text-pit-text-muted">Correct half (top/bottom 10)</span>
							<span class="text-pit-yellow font-bold">+1 pt</span>
						</div>
						<div class="border-t border-pit-border pt-2 mt-2">
							<span class="text-pit-text-muted">Max possible: 80 pts</span>
						</div>
					</div>
				</div>

				<!-- How it works -->
				<div class="bg-pit-surface border border-pit-border p-4">
					<div class="flex items-center gap-2 mb-3">
						<div class="w-0.5 h-4 bg-pit-blue"></div>
						<h3 class="heading-f1 text-xs text-pit-text-dim">HOW IT WORKS</h3>
					</div>
					<div class="space-y-2 text-[11px] text-pit-text-muted data-mono">
						<div class="flex items-start gap-1.5">
							<span class="text-pit-accent">1</span>
							<span>Drag drivers into your predicted race order</span>
						</div>
						<div class="flex items-start gap-1.5">
							<span class="text-pit-accent">2</span>
							<span>Lock in your prediction before the race starts</span>
						</div>
						<div class="flex items-start gap-1.5">
							<span class="text-pit-accent">3</span>
							<span>After the race, see your score vs the Pitwall AI model</span>
						</div>
						<div class="flex items-start gap-1.5">
							<span class="text-pit-accent">4</span>
							<span>Beat the algorithm to prove your F1 knowledge</span>
						</div>
					</div>
				</div>

				<!-- Side-by-side results (after race) -->
				{#if resultsLoaded && actualResults.size > 0 && locked}
					<div class="bg-pit-surface border border-pit-border p-4">
						<div class="flex items-center gap-2 mb-3">
							<div class="w-0.5 h-4 bg-pit-green"></div>
							<h3 class="heading-f1 text-xs text-pit-text-dim">RESULTS COMPARISON</h3>
						</div>
						<div class="overflow-x-auto">
							<table class="w-full text-[10px] data-mono">
								<thead>
									<tr class="text-pit-text-muted uppercase tracking-widest">
										<th class="text-left py-1 pr-2">Driver</th>
										<th class="text-center py-1 px-1">You</th>
										<th class="text-center py-1 px-1">Model</th>
										<th class="text-center py-1 pl-1">Actual</th>
									</tr>
								</thead>
								<tbody>
									{#each [...actualResults.entries()].sort((a, b) => a[1] - b[1]) as [driverNum, actualPos]}
										{@const driver = drivers.find((d) => d.driver_number === driverNum)}
										{@const userPos = dndItems.findIndex((d) => d.id === driverNum) + 1}
										{@const modelPos = modelPrediction?.predictions.find((p) => p.driver_number === driverNum)?.predicted_position}
										<tr class="border-t border-pit-border/50">
											<td class="py-1 pr-2 text-pit-text">{driver?.name_acronym ?? `#${driverNum}`}</td>
											<td class="text-center py-1 px-1 {userPos === actualPos ? 'text-pit-green font-bold' : 'text-pit-text-muted'}">
												P{userPos || '-'}
											</td>
											<td class="text-center py-1 px-1 {modelPos === actualPos ? 'text-pit-green font-bold' : 'text-pit-text-muted'}">
												{modelPos ? `P${modelPos}` : '-'}
											</td>
											<td class="text-center py-1 pl-1 text-pit-text font-bold">P{actualPos}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
