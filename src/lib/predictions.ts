import { getSessions, getLaps, getPositions, getDrivers, uniqueDrivers } from './api';
import type { Session, Driver, Lap, Position } from './api';

// Circuit overtaking difficulty multiplier
// Low = hard to overtake (street circuits), High = easy (long straights)
export const CIRCUIT_OVERTAKING: Record<string, number> = {
	monaco: 0.1,
	singapore: 0.3,
	hungary: 0.4,
	zandvoort: 0.4,
	mexico: 0.5,
	melbourne: 0.5,
	baku: 0.7,
	imola: 0.6,
	barcelona: 0.5,
	spielberg: 0.8,
	silverstone: 0.7,
	spa: 0.9,
	monza: 2.0,
	lusail: 0.8,
	jeddah: 0.9,
	sakhir: 0.8,
	suzuka: 0.5,
	shanghai: 0.7,
	miami: 0.6,
	vegas: 0.8,
	interlagos: 0.9,
	yas_marina: 0.6,
	montreal: 0.7,
};

export interface PredictedPosition {
	driver_number: number;
	driver: Driver | null;
	predicted_position: number;
	confidence: number; // 0-100
	position_change?: number; // positive = gains, negative = loses
	factors: string[];
}

export interface StagePrediction {
	stage: 'pre-quali' | 'qualifying' | 'race';
	predictions: PredictedPosition[];
	q1_dropouts?: PredictedPosition[];
	q2_dropouts?: PredictedPosition[];
	expected_movers?: PredictedPosition[];
	model_notes: string[];
}

// ============ DATA FETCHING HELPERS ============

// Fetch historical sessions for a circuit across years
async function getHistoricalSessions(circuitShortName: string, years: number[]): Promise<Session[]> {
	const all: Session[] = [];
	for (const year of years) {
		try {
			const sessions = await getSessions({ circuit_short_name: circuitShortName, year });
			all.push(...sessions);
		} catch {
			// Year might not have data
		}
	}
	return all;
}

// Get final positions from a session using /position endpoint
async function getSessionResults(sessionKey: number): Promise<Map<number, number>> {
	try {
		const positions = await getPositions(sessionKey);
		const finalPositions = new Map<number, number>();
		for (const p of positions) {
			finalPositions.set(p.driver_number, p.position);
		}
		return finalPositions;
	} catch {
		return new Map();
	}
}

// Get fastest lap per driver from a session
async function getFastestLaps(sessionKey: number): Promise<Map<number, number>> {
	try {
		const laps = await getLaps(sessionKey);
		const fastest = new Map<number, number>();
		for (const lap of laps) {
			if (lap.lap_duration && !lap.is_pit_out_lap) {
				const current = fastest.get(lap.driver_number);
				if (!current || lap.lap_duration < current) {
					fastest.set(lap.driver_number, lap.lap_duration);
				}
			}
		}
		return fastest;
	} catch {
		return new Map();
	}
}

// Get drivers for a session (with deduplication)
async function getSessionDrivers(sessionKey: number): Promise<Driver[]> {
	try {
		const raw = await getDrivers(sessionKey);
		return uniqueDrivers(raw);
	} catch {
		return [];
	}
}

// ============ TEAM PERFORMANCE BASELINE ============

interface TeamStats {
	team: string;
	avgQualiPos: number;
	avgRacePos: number;
	racesCount: number;
	qualiCount: number;
	// Per-driver breakdown within team
	driverAvgQuali: Map<number, { avg: number; count: number }>;
	driverAvgRace: Map<number, { avg: number; count: number }>;
	// Race vs quali delta (positive = gains positions in race)
	avgRaceDelta: number;
	deltaCount: number;
}

// Fetch all 2026 qualifying + race sessions and compute team baselines
async function computeTeamBaselines(currentYear: number): Promise<Map<string, TeamStats>> {
	const teamMap = new Map<string, TeamStats>();

	const initTeam = (name: string): TeamStats => ({
		team: name,
		avgQualiPos: 0,
		avgRacePos: 0,
		racesCount: 0,
		qualiCount: 0,
		driverAvgQuali: new Map(),
		driverAvgRace: new Map(),
		avgRaceDelta: 0,
		deltaCount: 0,
	});

	// Fetch all 2026 sessions
	let allSessions: Session[] = [];
	try {
		allSessions = await getSessions({ year: currentYear });
	} catch {
		return teamMap;
	}

	const qualiSessions = allSessions.filter(
		(s) => s.session_type === 'Qualifying' || s.session_name?.includes('Qualifying')
	);
	const raceSessions = allSessions.filter(
		(s) => s.session_type === 'Race' || s.session_name === 'Race'
	);

	// Process qualifying sessions to get team average grid positions
	for (const session of qualiSessions) {
		const results = await getSessionResults(session.session_key);
		const sessionDrivers = await getSessionDrivers(session.session_key);
		const driverTeamMap = new Map<number, string>();
		for (const d of sessionDrivers) {
			driverTeamMap.set(d.driver_number, d.team_name);
		}

		for (const [driverNum, pos] of results) {
			const team = driverTeamMap.get(driverNum);
			if (!team) continue;
			if (!teamMap.has(team)) teamMap.set(team, initTeam(team));
			const stats = teamMap.get(team)!;

			// Accumulate for team average (we'll divide later)
			stats.avgQualiPos += pos;
			stats.qualiCount++;

			// Per-driver quali tracking
			if (!stats.driverAvgQuali.has(driverNum)) {
				stats.driverAvgQuali.set(driverNum, { avg: 0, count: 0 });
			}
			const dq = stats.driverAvgQuali.get(driverNum)!;
			dq.avg += pos;
			dq.count++;
		}
	}

	// Process race sessions for team average race positions
	for (const session of raceSessions) {
		const raceResults = await getSessionResults(session.session_key);
		const sessionDrivers = await getSessionDrivers(session.session_key);
		const driverTeamMap = new Map<number, string>();
		for (const d of sessionDrivers) {
			driverTeamMap.set(d.driver_number, d.team_name);
		}

		// Find corresponding quali session for race delta
		const qualiSession = qualiSessions.find(
			(s) => s.meeting_key === session.meeting_key
		);
		const qualiResults = qualiSession ? await getSessionResults(qualiSession.session_key) : new Map<number, number>();

		for (const [driverNum, racePos] of raceResults) {
			const team = driverTeamMap.get(driverNum);
			if (!team) continue;
			if (!teamMap.has(team)) teamMap.set(team, initTeam(team));
			const stats = teamMap.get(team)!;

			stats.avgRacePos += racePos;
			stats.racesCount++;

			// Per-driver race tracking
			if (!stats.driverAvgRace.has(driverNum)) {
				stats.driverAvgRace.set(driverNum, { avg: 0, count: 0 });
			}
			const dr = stats.driverAvgRace.get(driverNum)!;
			dr.avg += racePos;
			dr.count++;

			// Race vs quali delta
			const qualiPos = qualiResults.get(driverNum);
			if (qualiPos !== undefined) {
				stats.avgRaceDelta += (qualiPos - racePos); // positive = gained positions
				stats.deltaCount++;
			}
		}
	}

	// Finalize averages
	for (const stats of teamMap.values()) {
		if (stats.qualiCount > 0) stats.avgQualiPos /= stats.qualiCount;
		if (stats.racesCount > 0) stats.avgRacePos /= stats.racesCount;
		if (stats.deltaCount > 0) stats.avgRaceDelta /= stats.deltaCount;

		for (const dq of stats.driverAvgQuali.values()) {
			if (dq.count > 0) dq.avg /= dq.count;
		}
		for (const dr of stats.driverAvgRace.values()) {
			if (dr.count > 0) dr.avg /= dr.count;
		}
	}

	return teamMap;
}

// ============ CIRCUIT HISTORY (TEAM-BASED) ============

interface CircuitHistoryScore {
	team: string;
	avgPos: number;
	dataPoints: number;
}

async function computeCircuitHistory(
	circuitShortName: string,
	years: number[]
): Promise<Map<string, CircuitHistoryScore>> {
	const teamScores = new Map<string, CircuitHistoryScore>();
	const historicalSessions = await getHistoricalSessions(circuitShortName, years);

	const relevantSessions = historicalSessions.filter(
		(s) =>
			s.session_type === 'Qualifying' ||
			s.session_type === 'Race' ||
			s.session_name?.includes('Qualifying') ||
			s.session_name === 'Race'
	);

	for (const session of relevantSessions) {
		const results = await getSessionResults(session.session_key);
		const sessionDrivers = await getSessionDrivers(session.session_key);
		const driverTeamMap = new Map<number, string>();
		for (const d of sessionDrivers) {
			driverTeamMap.set(d.driver_number, d.team_name);
		}

		for (const [driverNum, pos] of results) {
			const team = driverTeamMap.get(driverNum);
			if (!team) continue;

			if (!teamScores.has(team)) {
				teamScores.set(team, { team, avgPos: 0, dataPoints: 0 });
			}
			const entry = teamScores.get(team)!;
			entry.avgPos += pos;
			entry.dataPoints++;
		}
	}

	// Finalize averages
	for (const entry of teamScores.values()) {
		if (entry.dataPoints > 0) entry.avgPos /= entry.dataPoints;
	}

	return teamScores;
}

// ============ RECENT FORM (DRIVER-LEVEL) ============

interface RecentFormScore {
	driverNumber: number;
	avgFinish: number;
	races: number;
	trend: number; // negative = improving (positions getting lower), positive = declining
	results: { circuit: string; pos: number }[];
}

async function computeRecentForm(
	currentYear: number,
	driverNumbers: number[]
): Promise<Map<number, RecentFormScore>> {
	const formMap = new Map<number, RecentFormScore>();
	for (const dn of driverNumbers) {
		formMap.set(dn, { driverNumber: dn, avgFinish: 0, races: 0, trend: 0, results: [] });
	}

	try {
		const raceSessions = await getSessions({ year: currentYear, session_type: 'Race' });
		const lastThree = raceSessions.slice(-3);

		for (const session of lastThree) {
			const results = await getSessionResults(session.session_key);
			for (const [driverNum, pos] of results) {
				const entry = formMap.get(driverNum);
				if (entry) {
					entry.avgFinish += pos;
					entry.races++;
					entry.results.push({ circuit: session.circuit_short_name, pos });
				}
			}
		}
	} catch {
		// No recent data
	}

	// Finalize
	for (const entry of formMap.values()) {
		if (entry.races > 0) {
			entry.avgFinish /= entry.races;
			// Trend: compare first half vs second half of results
			if (entry.results.length >= 2) {
				const mid = Math.floor(entry.results.length / 2);
				const earlyAvg = entry.results.slice(0, mid).reduce((s, r) => s + r.pos, 0) / mid;
				const lateAvg = entry.results.slice(mid).reduce((s, r) => s + r.pos, 0) / (entry.results.length - mid);
				entry.trend = lateAvg - earlyAvg; // negative = improving
			}
		}
	}

	return formMap;
}

// ============ WEIGHTED PREDICTION BUILDER ============

const WEIGHT_TEAM_PERFORMANCE = 0.60;
const WEIGHT_CIRCUIT_HISTORY = 0.25;
const WEIGHT_RECENT_FORM = 0.15;

interface DriverScore {
	driverNumber: number;
	driver: Driver | null;
	teamScore: number;       // 0-1, higher = better
	circuitScore: number;    // 0-1, higher = better
	formScore: number;       // 0-1, higher = better
	weightedScore: number;   // final combined score
	factors: string[];
	dataPoints: number;
	raceDelta: number;       // avg positions gained in race vs quali
}

function buildWeightedPredictions(
	currentDrivers: Driver[],
	teamBaselines: Map<string, TeamStats>,
	circuitHistory: Map<string, CircuitHistoryScore>,
	recentForm: Map<number, RecentFormScore>,
	stage: 'pre-quali' | 'qualifying' | 'race',
	gridPositions?: Map<number, number>,
	overtakingFactor?: number
): PredictedPosition[] {
	const scores: DriverScore[] = [];

	// Find best/worst team performance for normalization
	const allTeamQualiAvgs = [...teamBaselines.values()]
		.filter((t) => t.qualiCount > 0)
		.map((t) => t.avgQualiPos);
	const bestTeamPos = Math.min(...allTeamQualiAvgs, 20);
	const worstTeamPos = Math.max(...allTeamQualiAvgs, 1);
	const teamRange = worstTeamPos - bestTeamPos || 1;

	// Find best/worst circuit history for normalization
	const allCircuitAvgs = [...circuitHistory.values()]
		.filter((c) => c.dataPoints > 0)
		.map((c) => c.avgPos);
	const bestCircuitPos = Math.min(...allCircuitAvgs, 20);
	const worstCircuitPos = Math.max(...allCircuitAvgs, 1);
	const circuitRange = worstCircuitPos - bestCircuitPos || 1;

	// Find best/worst recent form for normalization
	const allFormAvgs = [...recentForm.values()]
		.filter((f) => f.races > 0)
		.map((f) => f.avgFinish);
	const bestFormPos = Math.min(...allFormAvgs, 20);
	const worstFormPos = Math.max(...allFormAvgs, 1);
	const formRange = worstFormPos - bestFormPos || 1;

	for (const driver of currentDrivers) {
		const teamStats = teamBaselines.get(driver.team_name);
		const circuitStats = circuitHistory.get(driver.team_name);
		const form = recentForm.get(driver.driver_number);

		const factors: string[] = [];
		let dataPoints = 0;

		// Team performance score (inverted: lower position = higher score)
		let teamScore = 0.5; // default for unknown teams
		if (teamStats && teamStats.qualiCount > 0) {
			// Use driver-specific avg within team if available, else team avg
			const driverQuali = teamStats.driverAvgQuali.get(driver.driver_number);
			const avgPos = driverQuali && driverQuali.count > 0 ? driverQuali.avg : teamStats.avgQualiPos;
			teamScore = 1 - (avgPos - bestTeamPos) / teamRange;
			teamScore = Math.max(0, Math.min(1, teamScore));
			factors.push(`2026 avg grid: P${avgPos.toFixed(1)}`);
			dataPoints += teamStats.qualiCount;
		}

		// Circuit history score (team-based)
		let circuitScore = 0.5;
		if (circuitStats && circuitStats.dataPoints > 0) {
			circuitScore = 1 - (circuitStats.avgPos - bestCircuitPos) / circuitRange;
			circuitScore = Math.max(0, Math.min(1, circuitScore));
			factors.push(`Circuit history: P${circuitStats.avgPos.toFixed(1)} avg`);
			dataPoints += circuitStats.dataPoints;
		} else {
			factors.push('No circuit history');
		}

		// Recent form score (driver-level)
		let formScore = 0.5;
		if (form && form.races > 0) {
			formScore = 1 - (form.avgFinish - bestFormPos) / formRange;
			formScore = Math.max(0, Math.min(1, formScore));
			const trendLabel = form.trend < -1 ? ' (trending up)' : form.trend > 1 ? ' (trending down)' : '';
			factors.push(`Recent form: P${form.avgFinish.toFixed(1)} avg${trendLabel}`);
			dataPoints += form.races;
		}

		// Race delta (used in race stage)
		let raceDelta = 0;
		if (teamStats && teamStats.deltaCount > 0) {
			raceDelta = teamStats.avgRaceDelta;
		}

		// Weighted combination
		let weightedScore = teamScore * WEIGHT_TEAM_PERFORMANCE +
			circuitScore * WEIGHT_CIRCUIT_HISTORY +
			formScore * WEIGHT_RECENT_FORM;

		// For race predictions: adjust by race delta and grid position
		if (stage === 'race' && gridPositions) {
			const gridPos = gridPositions.get(driver.driver_number);
			if (gridPos !== undefined) {
				factors.push(`Grid: P${gridPos}`);
				// Grid position influence (higher at low-overtaking circuits)
				const of = overtakingFactor ?? 0.6;
				const gridInfluence = 0.3 - of * 0.15; // Monaco: 0.285, Monza: 0.0
				const gridScore = 1 - (gridPos - 1) / 19;
				weightedScore = weightedScore * (1 - gridInfluence) + gridScore * gridInfluence;
			}

			if (Math.abs(raceDelta) >= 0.5) {
				factors.push(`Race delta: ${raceDelta > 0 ? '+' : ''}${raceDelta.toFixed(1)} pos avg`);
			}
		}

		scores.push({
			driverNumber: driver.driver_number,
			driver,
			teamScore,
			circuitScore,
			formScore,
			weightedScore,
			factors,
			dataPoints,
			raceDelta,
		});
	}

	// Sort by weighted score (highest = best predicted position)
	scores.sort((a, b) => b.weightedScore - a.weightedScore);

	// Assign positions and calculate confidence
	return scores.map((s, i) => {
		// Confidence based on data availability and score separation
		const dataCoverage = Math.min(s.dataPoints / 10, 1.0);
		const hasTeamData = s.teamScore !== 0.5 ? 1 : 0;
		const hasCircuitData = s.circuitScore !== 0.5 ? 1 : 0;
		const hasFormData = s.formScore !== 0.5 ? 1 : 0;
		const sourceCoverage = (hasTeamData + hasCircuitData + hasFormData) / 3;

		const confidence = Math.round(
			Math.max(5, Math.min(95, dataCoverage * 40 + sourceCoverage * 40 + 15))
		);

		return {
			driver_number: s.driverNumber,
			driver: s.driver,
			predicted_position: i + 1,
			confidence,
			factors: s.factors.slice(0, 5),
		};
	});
}

// ============ STAGE 1: PRE-QUALIFYING PREDICTION ============

export async function predictPreQuali(
	circuitShortName: string,
	currentYear: number,
	currentDrivers: Driver[]
): Promise<StagePrediction> {
	const notes: string[] = [];

	// Step 1: Team performance baselines from all 2026 data
	const teamBaselines = await computeTeamBaselines(currentYear);
	const teamsWithData = [...teamBaselines.values()].filter((t) => t.qualiCount > 0);
	if (teamsWithData.length > 0) {
		notes.push(`Team baselines from ${teamsWithData.length} teams across 2026 season`);
		// Show top 3 teams
		const sorted = teamsWithData.sort((a, b) => a.avgQualiPos - b.avgQualiPos);
		const topTeams = sorted.slice(0, 3).map((t) => `${t.team} (P${t.avgQualiPos.toFixed(1)})`);
		notes.push(`Top teams: ${topTeams.join(', ')}`);
	} else {
		notes.push('No 2026 qualifying data available yet');
	}

	// Step 2: Circuit history (team-level)
	const circuitHistory = await computeCircuitHistory(circuitShortName, [currentYear - 1, currentYear - 2]);
	const circuitTeams = [...circuitHistory.values()].filter((c) => c.dataPoints > 0);
	if (circuitTeams.length > 0) {
		notes.push(`Circuit history from ${circuitTeams.length} teams at ${circuitShortName}`);
	}

	// Step 3: Recent form
	const driverNumbers = currentDrivers.map((d) => d.driver_number);
	const recentForm = await computeRecentForm(currentYear, driverNumbers);
	const driversWithForm = [...recentForm.values()].filter((f) => f.races > 0);
	if (driversWithForm.length > 0) {
		notes.push(`Recent form from last ${driversWithForm[0].races} race(s)`);
	}

	const predictions = buildWeightedPredictions(
		currentDrivers,
		teamBaselines,
		circuitHistory,
		recentForm,
		'pre-quali'
	);

	notes.push(`Weights: Team ${WEIGHT_TEAM_PERFORMANCE * 100}% / Circuit ${WEIGHT_CIRCUIT_HISTORY * 100}% / Form ${WEIGHT_RECENT_FORM * 100}%`);

	return { stage: 'pre-quali', predictions, model_notes: notes };
}

// ============ STAGE 2: QUALIFYING PREDICTION ============

export async function predictQualifying(
	circuitShortName: string,
	currentYear: number,
	currentDrivers: Driver[],
	fpSessionKeys: number[]
): Promise<StagePrediction> {
	const notes: string[] = [];

	// Step 1: Team baselines
	const teamBaselines = await computeTeamBaselines(currentYear);
	const teamsWithData = [...teamBaselines.values()].filter((t) => t.qualiCount > 0);
	if (teamsWithData.length > 0) {
		notes.push(`Team baselines from ${teamsWithData.length} teams`);
	}

	// Step 2: Circuit history
	const circuitHistory = await computeCircuitHistory(circuitShortName, [currentYear - 1, currentYear - 2]);

	// Step 3: Recent form — but augment with FP pace if available
	const driverNumbers = currentDrivers.map((d) => d.driver_number);
	const recentForm = await computeRecentForm(currentYear, driverNumbers);

	// FP pace bonus: adjust recent form scores based on practice performance
	let fpDataFound = false;
	const fpBestTimes = new Map<number, number>();
	for (const fpKey of fpSessionKeys) {
		const fastest = await getFastestLaps(fpKey);
		if (fastest.size > 0) fpDataFound = true;
		for (const [driverNum, time] of fastest) {
			const current = fpBestTimes.get(driverNum);
			if (!current || time < current) {
				fpBestTimes.set(driverNum, time);
			}
		}
	}

	// If we have FP data, blend it into the form scores
	if (fpDataFound && fpBestTimes.size > 0) {
		const sorted = [...fpBestTimes.entries()].sort((a, b) => a[1] - b[1]);
		const fastestTime = sorted[0][1];

		for (let i = 0; i < sorted.length; i++) {
			const [driverNum, time] = sorted[i];
			const form = recentForm.get(driverNum);
			if (form) {
				// Blend FP ranking into form: FP position weighted heavily
				const fpPosition = i + 1;
				const gap = time - fastestTime;
				if (form.races > 0) {
					// Blend: 60% FP pace, 40% recent form for quali prediction
					form.avgFinish = fpPosition * 0.6 + form.avgFinish * 0.4;
				} else {
					form.avgFinish = fpPosition;
					form.races = 1;
				}
				form.results.push({ circuit: 'FP', pos: fpPosition });
				form.trend = 0; // Reset trend, FP data is most current
			}
		}

		notes.push(`Practice pace from ${fpSessionKeys.length} FP session(s) — blended into form`);
	}

	const predictions = buildWeightedPredictions(
		currentDrivers,
		teamBaselines,
		circuitHistory,
		recentForm,
		'qualifying'
	);

	// Q1/Q2 dropouts
	const q1Dropouts = predictions.slice(15);
	const q2Dropouts = predictions.slice(10, 15);

	const circuitTeams = [...circuitHistory.values()].filter((c) => c.dataPoints > 0);
	if (circuitTeams.length > 0) {
		notes.push(`Circuit history from ${circuitTeams.length} teams at ${circuitShortName}`);
	}
	notes.push('Q1 cutoff: P16-P20, Q2 cutoff: P11-P15');

	return {
		stage: 'qualifying',
		predictions,
		q1_dropouts: q1Dropouts,
		q2_dropouts: q2Dropouts,
		model_notes: notes,
	};
}

// ============ STAGE 3: RACE PREDICTION ============

export async function predictRace(
	circuitShortName: string,
	currentYear: number,
	currentDrivers: Driver[],
	gridPositions: Map<number, number>
): Promise<StagePrediction> {
	const notes: string[] = [];
	const overtakingFactor = CIRCUIT_OVERTAKING[circuitShortName] ?? 0.6;

	// Step 1: Team baselines (includes race delta)
	const teamBaselines = await computeTeamBaselines(currentYear);
	const teamsWithData = [...teamBaselines.values()].filter((t) => t.racesCount > 0);
	if (teamsWithData.length > 0) {
		notes.push(`Team baselines from ${teamsWithData.length} teams`);
		// Show teams with best race delta
		const deltaTeams = teamsWithData
			.filter((t) => Math.abs(t.avgRaceDelta) >= 0.5)
			.sort((a, b) => b.avgRaceDelta - a.avgRaceDelta);
		if (deltaTeams.length > 0) {
			const gainers = deltaTeams.filter((t) => t.avgRaceDelta > 0).slice(0, 2);
			if (gainers.length > 0) {
				notes.push(`Race gainers: ${gainers.map((t) => `${t.team} (+${t.avgRaceDelta.toFixed(1)})`).join(', ')}`);
			}
		}
	}

	// Step 2: Circuit history
	const circuitHistory = await computeCircuitHistory(circuitShortName, [currentYear - 1, currentYear - 2]);

	// Step 3: Recent form
	const driverNumbers = currentDrivers.map((d) => d.driver_number);
	const recentForm = await computeRecentForm(currentYear, driverNumbers);

	notes.push(`Overtaking factor: ${overtakingFactor.toFixed(1)}x (${overtakingFactor < 0.5 ? 'hard' : overtakingFactor > 1.0 ? 'easy' : 'medium'})`);

	const predictions = buildWeightedPredictions(
		currentDrivers,
		teamBaselines,
		circuitHistory,
		recentForm,
		'race',
		gridPositions,
		overtakingFactor
	);

	// Calculate expected movers (compare predicted race position to grid)
	const expectedMovers: PredictedPosition[] = [];
	for (const pred of predictions) {
		const gridPos = gridPositions.get(pred.driver_number);
		if (gridPos !== undefined) {
			const change = gridPos - pred.predicted_position;
			pred.position_change = change;
			if (Math.abs(change) >= 2) {
				expectedMovers.push({ ...pred });
			}
		}
	}
	expectedMovers.sort((a, b) => Math.abs(b.position_change ?? 0) - Math.abs(a.position_change ?? 0));

	notes.push(`Weights: Team ${WEIGHT_TEAM_PERFORMANCE * 100}% / Circuit ${WEIGHT_CIRCUIT_HISTORY * 100}% / Form ${WEIGHT_RECENT_FORM * 100}%`);
	notes.push('Position changes relative to qualifying grid');

	return {
		stage: 'race',
		predictions,
		expected_movers: expectedMovers,
		model_notes: notes,
	};
}

// ============ STAGE HELPERS ============

// Determine which prediction stage is active based on session schedule
export function getActiveStage(
	sessions: Session[]
): 'pre-quali' | 'qualifying' | 'race' {
	const now = new Date();

	const quali = sessions.find(
		(s) => s.session_type === 'Qualifying' || s.session_name?.includes('Qualifying')
	);
	const race = sessions.find(
		(s) => s.session_type === 'Race' || s.session_name === 'Race'
	);

	if (quali && new Date(quali.date_start) > now) return 'pre-quali';
	if (race && new Date(race.date_start) > now) return 'qualifying';
	return 'race';
}

// Get FP session keys for a race weekend
export function getFPSessionKeys(sessions: Session[]): number[] {
	return sessions
		.filter(
			(s) =>
				s.session_type === 'Practice' ||
				s.session_name?.includes('Practice') ||
				s.session_name?.includes('FP')
		)
		.map((s) => s.session_key);
}
