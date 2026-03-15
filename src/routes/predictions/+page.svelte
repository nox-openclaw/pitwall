<script lang="ts">
	import { getSessions, getDrivers, getPositions, uniqueDrivers } from '$lib/api';
	import type { Session, Driver } from '$lib/api';
	import { getTeamColor } from '$lib/colors';
	import {
		predictPreQuali,
		predictQualifying,
		predictRace,
		getActiveStage,
		getFPSessionKeys,
		CIRCUIT_OVERTAKING,
		type PredictedPosition,
		type StagePrediction,
	} from '$lib/predictions';

	type Stage = 'pre-quali' | 'qualifying' | 'race';

	const TEAM_SLUGS: Record<string, string> = {
		'Mercedes': 'mercedes',
		'Red Bull Racing': 'red-bull',
		'Ferrari': 'ferrari',
		'McLaren': 'mclaren',
		'Aston Martin': 'aston-martin',
		'Alpine': 'alpine',
		'Williams': 'williams',
		'Haas F1 Team': 'haas',
		'Racing Bulls': 'racing-bulls',
		'Kick Sauber': 'kick-sauber',
		'Cadillac': 'cadillac',
	};

	const FACTOR_LABELS: Record<string, string> = {
		'Season Trend': 'Season form',
		'Car/Team Performance': 'Car pace',
		'Track History (2026)': 'Circuit history',
		'Reliability + ERS': 'Reliability',
		'Driver Skill': 'Driver skill',
	};

	let loading = $state(true);
	let error = $state('');
	let activeTab = $state<Stage>('pre-quali');
	let selectedCircuit = $state('');
	let availableCircuits = $state<{ short_name: string; country: string; location: string }[]>([]);
	let weekendSessions = $state<Session[]>([]);
	let drivers = $state<Driver[]>([]);
	let prediction = $state<StagePrediction | null>(null);
	let predicting = $state(false);
	let autoStage = $state<Stage>('pre-quali');
	let expandedDriver = $state<number | null>(null);
	let logoErrors = $state<Set<number>>(new Set());

	function getTeamSlug(teamName: string): string | null {
		for (const [key, slug] of Object.entries(TEAM_SLUGS)) {
			if (teamName?.toLowerCase().includes(key.toLowerCase())) return slug;
		}
		return null;
	}

	function getTeamLogoUrl(teamName: string): string | null {
		const slug = getTeamSlug(teamName);
		if (!slug) return null;
		return `https://media.formula1.com/image/upload/f_auto,c_limit,q_75,w_112/content/dam/fom-website/teams/2026/${slug}.png`;
	}

	function handleLogoError(driverNumber: number) {
		logoErrors = new Set([...logoErrors, driverNumber]);
	}

	async function loadCircuits() {
		try {
			const sessions = await getSessions({ year: 2026 });
			const seen = new Set<string>();
			const circuits: typeof availableCircuits = [];
			for (const s of sessions) {
				if (!seen.has(s.circuit_short_name)) {
					seen.add(s.circuit_short_name);
					circuits.push({
						short_name: s.circuit_short_name,
						country: s.country_name,
						location: s.location,
					});
				}
			}
			availableCircuits = circuits;

			const now = new Date();
			const upcoming = sessions
				.filter((s) => s.session_type === 'Race' || s.session_name === 'Race')
				.find((s) => new Date(s.date_start) > now);
			if (upcoming) {
				selectedCircuit = upcoming.circuit_short_name;
			} else if (circuits.length > 0) {
				selectedCircuit = circuits[circuits.length - 1].short_name;
			}

			loading = false;
		} catch (e) {
			error = 'Failed to load circuit data';
			loading = false;
		}
	}

	async function loadWeekend(circuit: string) {
		if (!circuit) return;
		predicting = true;
		prediction = null;

		try {
			const sessions = await getSessions({ circuit_short_name: circuit, year: 2026 });
			weekendSessions = sessions;

			autoStage = getActiveStage(sessions);
			activeTab = autoStage;

			if (sessions.length > 0) {
				const latestSession = sessions[sessions.length - 1];
				const rawDrivers = await getDrivers(latestSession.session_key);
				drivers = uniqueDrivers(rawDrivers);
			}

			await runPrediction(autoStage, circuit);
		} catch (e) {
			error = 'Failed to load weekend data';
			predicting = false;
		}
	}

	async function runPrediction(stage: Stage, circuit?: string) {
		const c = circuit ?? selectedCircuit;
		if (!c || drivers.length === 0) return;
		predicting = true;
		expandedDriver = null;

		try {
			if (stage === 'pre-quali') {
				prediction = await predictPreQuali(c, 2026, drivers);
			} else if (stage === 'qualifying') {
				const fpKeys = getFPSessionKeys(weekendSessions);
				prediction = await predictQualifying(c, 2026, drivers, fpKeys);
			} else {
				const qualiSession = weekendSessions.find(
					(s) => s.session_type === 'Qualifying' || s.session_name?.includes('Qualifying')
				);
				const gridPositions = new Map<number, number>();
				if (qualiSession) {
					const positions = await getPositions(qualiSession.session_key);
					for (const p of positions) {
						gridPositions.set(p.driver_number, p.position);
					}
				} else {
					drivers.forEach((d, i) => gridPositions.set(d.driver_number, i + 1));
				}
				prediction = await predictRace(c, 2026, drivers, gridPositions);
			}
		} catch (e) {
			error = 'Prediction engine error';
		}
		predicting = false;
	}

	function switchTab(tab: Stage) {
		activeTab = tab;
		runPrediction(tab);
	}

	function toggleExpanded(driverNum: number) {
		expandedDriver = expandedDriver === driverNum ? null : driverNum;
	}

	function getChangeArrow(change: number): string {
		if (change > 0) return '▲';
		if (change < 0) return '▼';
		return '—';
	}

	function getChangeColor(change: number): string {
		if (change > 0) return '#00D26A';
		if (change < 0) return '#E8002D';
		return '#6B6B6B';
	}

	$effect(() => {
		loadCircuits();
	});

	$effect(() => {
		if (selectedCircuit) {
			loadWeekend(selectedCircuit);
		}
	});
</script>

<svelte:head>
	<title>Predictions — Pitwall</title>
</svelte:head>

<div class="max-w-7xl mx-auto px-4 py-6">
	<!-- Header -->
	<div class="flex items-center gap-3 mb-2">
		<div class="w-1 h-8 bg-pit-accent glow-red-subtle"></div>
		<h1 class="heading-f1 text-2xl text-pit-text">PREDICTION ENGINE</h1>
		<span class="text-[10px] uppercase tracking-widest text-pit-accent data-mono ml-2 border border-pit-accent/30 px-2 py-0.5">
			BETA
		</span>
	</div>
	<p class="text-xs text-pit-text-muted mb-6 ml-4">
		Predictions based on 2026 season form, qualifying pace, reliability and circuit history.
	</p>

	{#if loading}
		<div class="flex items-center justify-center py-20">
			<div class="spinner-f1 w-8 h-8"></div>
		</div>
	{:else if error && !prediction}
		<div class="text-pit-accent text-sm data-mono py-10 text-center">{error}</div>
	{:else}
		<!-- Circuit Selector -->
		<div class="mb-6">
			<label class="block text-[10px] uppercase tracking-widest text-pit-text-muted mb-2">Select Circuit</label>
			<select
				bind:value={selectedCircuit}
				class="bg-pit-surface border border-pit-border text-pit-text px-3 py-2 text-sm data-mono w-full max-w-md focus:border-pit-accent focus:outline-none"
			>
				{#each availableCircuits as circuit}
					<option value={circuit.short_name}>
						{circuit.location} — {circuit.country} ({circuit.short_name})
					</option>
				{/each}
			</select>
			{#if selectedCircuit && CIRCUIT_OVERTAKING[selectedCircuit]}
				<div class="mt-2 text-[10px] uppercase tracking-widest text-pit-text-muted data-mono">
					Overtaking difficulty: {CIRCUIT_OVERTAKING[selectedCircuit]?.toFixed(1)}x
					{#if CIRCUIT_OVERTAKING[selectedCircuit]! < 0.5}
						<span class="text-pit-accent ml-1">HARD TO OVERTAKE</span>
					{:else if CIRCUIT_OVERTAKING[selectedCircuit]! > 1.0}
						<span class="text-pit-green ml-1">EASY TO OVERTAKE</span>
					{:else}
						<span class="text-pit-yellow ml-1">MEDIUM</span>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Stage Tabs -->
		<div class="flex border-b border-pit-border mb-6">
			<button
				onclick={() => switchTab('pre-quali')}
				class="px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors duration-150 border-b-2 {activeTab === 'pre-quali' ? 'text-pit-accent border-pit-accent' : 'text-pit-text-dim border-transparent hover:text-pit-text'}"
			>
				Pre-Quali
				{#if autoStage === 'pre-quali'}
					<span class="inline-block w-1.5 h-1.5 bg-pit-green rounded-full ml-1.5 pulse-live"></span>
				{/if}
			</button>
			<button
				onclick={() => switchTab('qualifying')}
				class="px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors duration-150 border-b-2 {activeTab === 'qualifying' ? 'text-pit-accent border-pit-accent' : 'text-pit-text-dim border-transparent hover:text-pit-text'}"
			>
				Qualifying
				{#if autoStage === 'qualifying'}
					<span class="inline-block w-1.5 h-1.5 bg-pit-green rounded-full ml-1.5 pulse-live"></span>
				{/if}
			</button>
			<button
				onclick={() => switchTab('race')}
				class="px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors duration-150 border-b-2 {activeTab === 'race' ? 'text-pit-accent border-pit-accent' : 'text-pit-text-dim border-transparent hover:text-pit-text'}"
			>
				Race
				{#if autoStage === 'race'}
					<span class="inline-block w-1.5 h-1.5 bg-pit-green rounded-full ml-1.5 pulse-live"></span>
				{/if}
			</button>
		</div>

		{#if predicting}
			<div class="flex items-center gap-3 py-16 justify-center">
				<div class="spinner-f1 w-6 h-6"></div>
				<span class="text-pit-text-dim text-xs uppercase tracking-widest data-mono">
					Crunching data...
				</span>
			</div>
		{:else if prediction}
			<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
				<!-- Predicted Grid -->
				<div class="lg:col-span-2">
					<div class="flex items-center gap-2 mb-4">
						<div class="w-0.5 h-5 bg-pit-accent"></div>
						<h2 class="heading-f1 text-sm text-pit-text-dim">
							{#if activeTab === 'pre-quali'}PREDICTED GRID
							{:else if activeTab === 'qualifying'}QUALIFYING PREDICTION
							{:else}RACE PREDICTION
							{/if}
						</h2>
					</div>

					{#if activeTab === 'qualifying' && prediction.q1_dropouts}
						<div class="mb-4 flex gap-4 text-[10px] uppercase tracking-widest text-pit-text-muted data-mono">
							<span>Q3: P1-P10</span>
							<span class="text-pit-yellow">Q2 dropout: P11-P15</span>
							<span class="text-pit-accent">Q1 dropout: P16-P20</span>
						</div>
					{/if}

					<div class="space-y-1">
						{#each prediction.predictions as pred, i}
							{@const teamColor = pred.driver ? getTeamColor(pred.driver.team_name, pred.driver.team_colour) : '#888'}
							{@const logoUrl = pred.driver ? getTeamLogoUrl(pred.driver.team_name) : null}
							{@const showFallback = !logoUrl || logoErrors.has(pred.driver_number)}
							{@const isQ1Dropout = activeTab === 'qualifying' && pred.predicted_position > 15}
							{@const isQ2Dropout = activeTab === 'qualifying' && pred.predicted_position > 10 && pred.predicted_position <= 15}
							{@const isExpanded = expandedDriver === pred.driver_number}
							{@const posChange = activeTab === 'race' ? (pred.position_change ?? 0) : 0}
							<div>
								<button
									onclick={() => toggleExpanded(pred.driver_number)}
									class="w-full flex items-center gap-3 bg-pit-surface border border-pit-border px-3 py-2 hover:border-pit-accent/30 transition-colors text-left {isQ1Dropout ? 'opacity-50' : isQ2Dropout ? 'opacity-70' : ''}"
								>
									<!-- Team Logo -->
									<div class="w-8 h-8 flex items-center justify-center shrink-0">
										{#if showFallback}
											<div class="w-5 h-5 rounded-full" style="background-color: {teamColor}"></div>
										{:else}
											<img
												src={logoUrl}
												alt={pred.driver?.team_name ?? ''}
												width="32"
												height="32"
												class="w-8 h-8 object-contain"
												onerror={() => handleLogoError(pred.driver_number)}
											/>
										{/if}
									</div>

									<!-- Position -->
									<div class="w-10 text-right shrink-0">
										<span class="data-mono text-lg font-black {i < 3 ? 'text-pit-accent' : 'text-pit-text'}">
											P{pred.predicted_position}
										</span>
									</div>

									<!-- Driver info -->
									<div class="flex-1 min-w-0">
										<div class="flex items-center gap-2">
											<span class="text-sm font-semibold text-pit-text">
												{pred.driver?.name_acronym ?? `#${pred.driver_number}`}
											</span>
											<span class="text-[10px] text-pit-text-muted truncate">
												{pred.driver?.team_name ?? ''}
											</span>
										</div>
									</div>

									<!-- Delta arrow (race tab) -->
									{#if activeTab === 'race' && posChange !== 0}
										<div class="flex items-center gap-1 data-mono text-xs shrink-0" style="color: {getChangeColor(posChange)}">
											<span>{getChangeArrow(posChange)}</span>
											<span class="font-bold">{Math.abs(posChange)}</span>
										</div>
									{/if}

									<!-- Reliability warning -->
									{#if pred.reliability_warning}
										<span class="text-sm text-pit-yellow shrink-0" title="DNF rate > 20%">&#9888;</span>
									{/if}
								</button>

								<!-- Expanded factor breakdown -->
								{#if isExpanded}
									<div class="bg-pit-bg border border-pit-border border-t-0 px-4 py-3">
										<button
											onclick={() => toggleExpanded(pred.driver_number)}
											class="flex items-center gap-1.5 mb-3 text-[10px] uppercase tracking-widest text-pit-text-muted hover:text-pit-text transition-colors"
										>
											<span class="text-pit-accent">▾</span>
											<span>Model details</span>
										</button>
										<div class="space-y-2">
											{#each pred.factors as factor}
												<div class="flex items-center gap-3">
													<span class="text-[10px] text-pit-text-muted w-24 shrink-0 uppercase tracking-wider">
														{FACTOR_LABELS[factor.name] ?? factor.name}
													</span>
													<div class="flex-1 flex items-center gap-2">
														<div class="flex-1 h-1.5 bg-pit-border rounded-full overflow-hidden">
															<div
																class="h-full rounded-full bg-pit-accent"
																style="width: {(factor.value / (factor.weight / 100)) * 100}%"
															></div>
														</div>
														<span class="text-[10px] text-pit-text-muted data-mono w-8 text-right">{factor.weight}%</span>
													</div>
													<span class="text-[10px] text-pit-text-dim data-mono shrink-0">{factor.detail}</span>
												</div>
											{/each}
											{#if pred.reliability_warning}
												<div class="flex items-center gap-2 mt-2 pt-2 border-t border-pit-border">
													<span class="text-pit-yellow text-xs">&#9888;</span>
													<span class="text-[10px] text-pit-yellow data-mono">
														RELIABILITY WARNING — {(pred.dnf_rate * 100).toFixed(0)}% DNF rate in 2026
													</span>
												</div>
											{/if}
										</div>
									</div>
								{/if}
							</div>

							<!-- Q2/Q1 cutoff lines -->
							{#if activeTab === 'qualifying' && pred.predicted_position === 10}
								<div class="flex items-center gap-2 py-1">
									<div class="flex-1 border-t border-dashed border-pit-yellow/50"></div>
									<span class="text-[9px] uppercase tracking-widest text-pit-yellow data-mono">Q2 CUTOFF</span>
									<div class="flex-1 border-t border-dashed border-pit-yellow/50"></div>
								</div>
							{/if}
							{#if activeTab === 'qualifying' && pred.predicted_position === 15}
								<div class="flex items-center gap-2 py-1">
									<div class="flex-1 border-t border-dashed border-pit-accent/50"></div>
									<span class="text-[9px] uppercase tracking-widest text-pit-accent data-mono">Q1 CUTOFF</span>
									<div class="flex-1 border-t border-dashed border-pit-accent/50"></div>
								</div>
							{/if}
						{/each}
					</div>
				</div>

				<!-- Sidebar -->
				<div class="space-y-6">
					<!-- Expected Movers (Race stage) -->
					{#if activeTab === 'race' && prediction.expected_movers && prediction.expected_movers.length > 0}
						<div class="bg-pit-surface border border-pit-border p-4">
							<div class="flex items-center gap-2 mb-3">
								<div class="w-0.5 h-4 bg-pit-accent"></div>
								<h3 class="heading-f1 text-xs text-pit-text-dim">EXPECTED MOVERS</h3>
							</div>
							<div class="space-y-2">
								{#each prediction.expected_movers.slice(0, 6) as mover}
									{@const change = mover.position_change ?? 0}
									<div class="flex items-center justify-between">
										<div class="flex items-center gap-2">
											<span
												class="w-5 text-center text-sm font-bold"
												style="color: {getChangeColor(change)}"
											>
												{getChangeArrow(change)}
											</span>
											<span class="text-sm text-pit-text">
												{mover.driver?.name_acronym ?? `#${mover.driver_number}`}
											</span>
											{#if mover.reliability_warning}
												<span class="text-[10px] text-pit-yellow">&#9888;</span>
											{/if}
										</div>
										<span class="data-mono text-xs" style="color: {getChangeColor(change)}">
											{change > 0 ? '+' : ''}{change} positions
										</span>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Reliability Warnings -->
					{#if prediction.predictions.some(p => p.reliability_warning)}
						<div class="bg-pit-surface border border-pit-yellow/30 p-4">
							<div class="flex items-center gap-2 mb-3">
								<span class="text-pit-yellow text-sm">&#9888;</span>
								<h3 class="heading-f1 text-xs text-pit-yellow">RELIABILITY RISKS</h3>
							</div>
							<div class="space-y-1.5">
								{#each prediction.predictions.filter(p => p.reliability_warning) as risk}
									<div class="flex items-center justify-between text-sm">
										<span class="text-pit-text">{risk.driver?.name_acronym ?? `#${risk.driver_number}`}</span>
										<span class="data-mono text-[10px] text-pit-yellow">
											{(risk.dnf_rate * 100).toFixed(0)}% DNF rate
										</span>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Q Dropouts (Qualifying stage) -->
					{#if activeTab === 'qualifying' && prediction.q2_dropouts}
						<div class="bg-pit-surface border border-pit-border p-4">
							<div class="flex items-center gap-2 mb-3">
								<div class="w-0.5 h-4 bg-pit-yellow"></div>
								<h3 class="heading-f1 text-xs text-pit-text-dim">Q2 ELIMINATION RISK</h3>
							</div>
							<div class="space-y-1.5">
								{#each prediction.q2_dropouts as dropout}
									<div class="flex items-center justify-between text-sm">
										<span class="text-pit-text">{dropout.driver?.name_acronym ?? `#${dropout.driver_number}`}</span>
										<span class="data-mono text-[10px] text-pit-yellow">P{dropout.predicted_position}</span>
									</div>
								{/each}
							</div>
						</div>
					{/if}
					{#if activeTab === 'qualifying' && prediction.q1_dropouts}
						<div class="bg-pit-surface border border-pit-border p-4">
							<div class="flex items-center gap-2 mb-3">
								<div class="w-0.5 h-4 bg-pit-accent"></div>
								<h3 class="heading-f1 text-xs text-pit-text-dim">Q1 ELIMINATION RISK</h3>
							</div>
							<div class="space-y-1.5">
								{#each prediction.q1_dropouts as dropout}
									<div class="flex items-center justify-between text-sm">
										<span class="text-pit-text">{dropout.driver?.name_acronym ?? `#${dropout.driver_number}`}</span>
										<span class="data-mono text-[10px] text-pit-accent">P{dropout.predicted_position}</span>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Model Notes -->
					<div class="bg-pit-surface border border-pit-border p-4">
						<div class="flex items-center gap-2 mb-3">
							<div class="w-0.5 h-4 bg-pit-accent"></div>
							<h3 class="heading-f1 text-xs text-pit-text-dim">MODEL NOTES</h3>
						</div>
						<div class="space-y-1.5 text-[11px] text-pit-text-muted data-mono">
							{#each prediction.model_notes as note}
								<div class="flex items-start gap-1.5">
									<span class="text-pit-accent mt-0.5">›</span>
									<span>{note}</span>
								</div>
							{/each}
						</div>
					</div>

					<!-- Model Info -->
					<div class="bg-pit-surface border border-pit-border p-4">
						<div class="flex items-center gap-2 mb-3">
							<div class="w-0.5 h-4 bg-pit-accent"></div>
							<h3 class="heading-f1 text-xs text-pit-text-dim">MODEL INFO</h3>
						</div>
						<div class="space-y-2 text-[11px] data-mono">
							<div class="flex justify-between">
								<span class="text-pit-text-muted">Data sources</span>
								<span class="text-pit-text">OpenF1 API</span>
							</div>
							<div class="flex justify-between">
								<span class="text-pit-text-muted">Season form</span>
								<span class="text-pit-text">40% — rolling 3-race avg</span>
							</div>
							<div class="flex justify-between">
								<span class="text-pit-text-muted">Car pace</span>
								<span class="text-pit-text">35% — avg quali pos</span>
							</div>
							<div class="flex justify-between">
								<span class="text-pit-text-muted">Circuit history</span>
								<span class="text-pit-text">10% — 2026 only</span>
							</div>
							<div class="flex justify-between">
								<span class="text-pit-text-muted">Reliability</span>
								<span class="text-pit-text">10% — DNF rate</span>
							</div>
							<div class="flex justify-between">
								<span class="text-pit-text-muted">Driver skill</span>
								<span class="text-pit-text">5% — teammate H2H</span>
							</div>
							<div class="flex justify-between">
								<span class="text-pit-text-muted">Stage</span>
								<span class="text-pit-accent uppercase">{activeTab}</span>
							</div>
						</div>
					</div>

					<!-- Circuit Overtaking Map -->
					<div class="bg-pit-surface border border-pit-border p-4">
						<div class="flex items-center gap-2 mb-3">
							<div class="w-0.5 h-4 bg-pit-accent"></div>
							<h3 class="heading-f1 text-xs text-pit-text-dim">OVERTAKING INDEX</h3>
						</div>
						<div class="space-y-1 max-h-48 overflow-y-auto">
							{#each Object.entries(CIRCUIT_OVERTAKING).sort((a, b) => b[1] - a[1]) as [circuit, factor]}
								<div class="flex items-center gap-2 text-[10px] data-mono {circuit === selectedCircuit ? 'text-pit-accent' : 'text-pit-text-muted'}">
									<span class="w-20 truncate uppercase">{circuit}</span>
									<div class="flex-1 h-1 bg-pit-border rounded-full overflow-hidden">
										<div
											class="h-full rounded-full"
											style="width: {factor / 2.0 * 100}%; background-color: {factor < 0.5 ? '#E8002D' : factor > 1.0 ? '#00D26A' : '#FFD700'}"
										></div>
									</div>
									<span class="w-6 text-right">{factor.toFixed(1)}</span>
								</div>
							{/each}
						</div>
					</div>
				</div>
			</div>
		{/if}
	{/if}
</div>
