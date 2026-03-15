import { getSessions, getPositions } from './api';
import type { Session, Driver } from './api';

// ============ INTELLIGENCE FACTORS ============

export interface IntelligenceFactor {
	_id?: string;
	team: string;
	driver?: string;
	factor_type: string;
	magnitude: number; // 0-1 scale
	direction_multiplier: number; // +1 = positive, -1 = negative
	confidence: number; // 0-1
	description?: string;
	source?: string;
	created_at?: string;
}

/** Fetch intelligence factors from /api/factors endpoint */
export async function fetchIntelligenceFactors(): Promise<IntelligenceFactor[]> {
	try {
		const base = typeof window === 'undefined' ? 'http://localhost:5173' : '';
		const res = await fetch(`${base}/api/factors`, { signal: AbortSignal.timeout(5000) });
		if (!res.ok) return [];
		const data = await res.json();
		return Array.isArray(data) ? data : [];
	} catch {
		return [];
	}
}

/** Factor type -> which score component to adjust */
const FACTOR_TYPE_MAP: Record<string, 'reliability' | 'car_performance' | 'recent_form'> = {
	reliability: 'reliability',
	mechanical_failure: 'reliability',
	dnf_cause: 'reliability',
	race_winner: 'car_performance',
	dominant_performance: 'car_performance',
	upgrade: 'car_performance',
	aero_efficiency: 'car_performance',
	ers_deployment: 'car_performance',
	poor_performance: 'recent_form',
	tyre_degradation: 'recent_form',
};

interface FactorAdjustment {
	reliability: number;
	car_performance: number;
	recent_form: number;
	applied: IntelligenceFactor[];
}

/** Calculate per-team factor adjustments, capped at +/- 0.2 */
function calcFactorAdjustments(
	factors: IntelligenceFactor[],
	teamName: string
): FactorAdjustment {
	const adj: FactorAdjustment = { reliability: 0, car_performance: 0, recent_form: 0, applied: [] };
	const CAP = 0.2;

	for (const f of factors) {
		if (f.team.toLowerCase() !== teamName.toLowerCase()) continue;
		const component = FACTOR_TYPE_MAP[f.factor_type];
		if (!component) continue;

		const delta = f.magnitude * f.direction_multiplier * f.confidence;
		adj[component] += delta;
		adj.applied.push(f);
	}

	// Cap each component at +/- 0.2
	adj.reliability = Math.max(-CAP, Math.min(CAP, adj.reliability));
	adj.car_performance = Math.max(-CAP, Math.min(CAP, adj.car_performance));
	adj.recent_form = Math.max(-CAP, Math.min(CAP, adj.recent_form));

	return adj;
}

// 2026 circuit overtaking factors — Active Aero + Overtake Mode replaces DRS
// Values recalibrated for wider cars with ground-effect + electric boost within 1s
export const CIRCUIT_OVERTAKING: Record<string, number> = {
	monaco: 0.2,
	singapore: 0.25,
	budapest: 0.3,
	zandvoort: 0.4,
	barcelona: 0.55,
	imola: 0.55,
	silverstone: 0.75,
	suzuka: 0.7,
	melbourne: 0.85,
	austin: 0.9,
	baku: 1.1,
	jeddah: 1.2,
	spa: 1.3,
	monza: 1.8,
	bahrain: 1.0,
	shanghai: 1.05,
};

export interface FactorBreakdown {
	name: string;
	weight: number; // percentage weight
	value: number; // raw contribution score
	detail: string; // human-readable detail
}

export interface PredictedPosition {
	driver_number: number;
	driver: Driver | null;
	predicted_position: number;
	confidence: number;
	position_change?: number;
	factors: FactorBreakdown[];
	reliability_warning: boolean;
	dnf_rate: number; // 0-1
	expected_race_delta?: number; // avg positions gained/lost grid->finish
}

export interface StagePrediction {
	stage: 'pre-quali' | 'qualifying' | 'race';
	predictions: PredictedPosition[];
	q1_dropouts?: PredictedPosition[];
	q2_dropouts?: PredictedPosition[];
	expected_movers?: PredictedPosition[];
	model_notes: string[];
}

// ============ DATA COLLECTION ============

interface SessionResult {
	session_key: number;
	session_type: string;
	circuit_short_name: string;
	year: number;
	positions: Map<number, number>; // driver_number -> final position
}

interface TeamStats {
	team_name: string;
	avg_quali_position: number;
	races_started: number;
	dnfs: number;
	dnf_rate: number;
	driver_numbers: number[];
}

interface DriverStats {
	driver_number: number;
	team_name: string;
	teammate_delta: number; // negative = outperforms teammate
	teammate_battles_won: number;
	teammate_battles_total: number;
	avg_race_delta: number; // avg positions gained from grid to finish
	race_delta_count: number;
}

const DNF_POSITION = 20;

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

/** Collect all 2026 qualifying and race results — only 2026 data is valid under new regs */
async function collect2026Data(): Promise<{
	qualiResults: SessionResult[];
	raceResults: SessionResult[];
}> {
	const qualiResults: SessionResult[] = [];
	const raceResults: SessionResult[] = [];

	try {
		const sessions = await getSessions({ year: 2026 });

		const qualiSessions = sessions.filter(
			(s) => s.session_type === 'Qualifying' || s.session_name?.includes('Qualifying')
		);
		const raceSessions = sessions.filter(
			(s) => s.session_type === 'Race' || s.session_name === 'Race'
		);

		const [qualiPositions, racePositions] = await Promise.all([
			Promise.all(qualiSessions.map((s) => getSessionResults(s.session_key))),
			Promise.all(raceSessions.map((s) => getSessionResults(s.session_key))),
		]);

		for (let i = 0; i < qualiSessions.length; i++) {
			if (qualiPositions[i].size > 0) {
				qualiResults.push({
					session_key: qualiSessions[i].session_key,
					session_type: 'Qualifying',
					circuit_short_name: qualiSessions[i].circuit_short_name,
					year: 2026,
					positions: qualiPositions[i],
				});
			}
		}

		for (let i = 0; i < raceSessions.length; i++) {
			if (racePositions[i].size > 0) {
				raceResults.push({
					session_key: raceSessions[i].session_key,
					session_type: 'Race',
					circuit_short_name: raceSessions[i].circuit_short_name,
					year: 2026,
					positions: racePositions[i],
				});
			}
		}
	} catch {
		// No 2026 data available yet
	}

	return { qualiResults, raceResults };
}

// ============ FACTOR CALCULATIONS ============

/**
 * Factor 1: Season Trend (40%) — rolling 3-race weighted average
 * Last race = 50%, previous = 30%, prev-prev = 20%
 * DNF counts as P20
 */
function calcSeasonTrend(
	raceResults: SessionResult[],
	drivers: Driver[]
): Map<number, { score: number; detail: string }> {
	const TREND_WEIGHTS = [0.5, 0.3, 0.2]; // most recent first
	const result = new Map<number, { score: number; detail: string }>();

	// Sort races chronologically (by session_key as proxy for date order)
	const sortedRaces = [...raceResults].sort((a, b) => a.session_key - b.session_key);
	const recentRaces = sortedRaces.slice(-3); // last 3 races

	for (const d of drivers) {
		let weightedSum = 0;
		let weightUsed = 0;
		const positions: string[] = [];

		for (let i = 0; i < recentRaces.length; i++) {
			const race = recentRaces[recentRaces.length - 1 - i]; // most recent first
			const weight = TREND_WEIGHTS[i];
			const pos = race.positions.get(d.driver_number);
			const effectivePos = pos ?? DNF_POSITION; // DNF = P20
			weightedSum += effectivePos * weight;
			weightUsed += weight;
			positions.push(pos !== undefined ? `P${pos}` : 'DNF');
		}

		if (weightUsed > 0) {
			const weightedAvg = weightedSum / weightUsed;
			result.set(d.driver_number, {
				score: weightedAvg,
				detail: `Rolling 3: ${positions.join(', ')} (weighted avg P${weightedAvg.toFixed(1)})`,
			});
		} else {
			result.set(d.driver_number, {
				score: 10, // neutral default
				detail: 'No recent race data',
			});
		}
	}

	return result;
}

/**
 * Factor 2: Car/Team Performance (35%) — avg qualifying position from 2026 only
 */
function calcTeamPerformance(
	qualiResults: SessionResult[],
	drivers: Driver[]
): Map<string, TeamStats> {
	const teamMap = new Map<string, { positions: number[]; driver_numbers: Set<number> }>();

	for (const d of drivers) {
		if (!teamMap.has(d.team_name)) {
			teamMap.set(d.team_name, { positions: [], driver_numbers: new Set() });
		}
		teamMap.get(d.team_name)!.driver_numbers.add(d.driver_number);
	}

	for (const result of qualiResults) {
		for (const [driverNum, pos] of result.positions) {
			for (const [, data] of teamMap) {
				if (data.driver_numbers.has(driverNum)) {
					data.positions.push(pos);
				}
			}
		}
	}

	const stats = new Map<string, TeamStats>();
	for (const [team, data] of teamMap) {
		const avg =
			data.positions.length > 0
				? data.positions.reduce((a, b) => a + b, 0) / data.positions.length
				: 10;
		stats.set(team, {
			team_name: team,
			avg_quali_position: avg,
			races_started: 0,
			dnfs: 0,
			dnf_rate: 0,
			driver_numbers: [...data.driver_numbers],
		});
	}

	return stats;
}

/**
 * Factor 3: Track History (10%) — same circuit in 2026 only
 * If fewer than 3 races at this circuit, weight is reduced and redistributed to season trend
 */
function calcTrackHistory2026(
	raceResults: SessionResult[],
	qualiResults: SessionResult[],
	circuitShortName: string,
	drivers: Driver[]
): { history: Map<number, { avgPos: number; count: number }>; racesAtCircuit: number } {
	const circuitRaces = raceResults.filter(
		(r) => r.circuit_short_name === circuitShortName
	);
	const circuitQualis = qualiResults.filter(
		(q) => q.circuit_short_name === circuitShortName
	);
	const allCircuitResults = [...circuitRaces, ...circuitQualis];

	const driverHistory = new Map<number, { total: number; count: number }>();
	const teamHistory = new Map<string, { total: number; count: number }>();

	for (const result of allCircuitResults) {
		for (const [driverNum, pos] of result.positions) {
			const existing = driverHistory.get(driverNum) ?? { total: 0, count: 0 };
			existing.total += pos;
			existing.count++;
			driverHistory.set(driverNum, existing);

			const driver = drivers.find((d) => d.driver_number === driverNum);
			if (driver) {
				const teamExisting = teamHistory.get(driver.team_name) ?? { total: 0, count: 0 };
				teamExisting.total += pos;
				teamExisting.count++;
				teamHistory.set(driver.team_name, teamExisting);
			}
		}
	}

	const history = new Map<number, { avgPos: number; count: number }>();
	for (const d of drivers) {
		const personal = driverHistory.get(d.driver_number);
		if (personal && personal.count > 0) {
			history.set(d.driver_number, {
				avgPos: personal.total / personal.count,
				count: personal.count,
			});
		} else {
			const team = teamHistory.get(d.team_name);
			if (team && team.count > 0) {
				history.set(d.driver_number, {
					avgPos: team.total / team.count,
					count: team.count,
				});
			}
		}
	}

	return { history, racesAtCircuit: circuitRaces.length };
}

/**
 * Factor 4: Reliability + ERS DNF rate (10%)
 * 2026: MGU-H removed, new ERS reliability failure points — DNF detection via quali/race mismatch
 */
function calcReliability(
	qualiResults: SessionResult[],
	raceResults: SessionResult[],
	teamStats: Map<string, TeamStats>,
	drivers: Driver[]
): void {
	const teamDrivers = new Map<string, Set<number>>();
	for (const d of drivers) {
		if (!teamDrivers.has(d.team_name)) teamDrivers.set(d.team_name, new Set());
		teamDrivers.get(d.team_name)!.add(d.driver_number);
	}

	for (const race of raceResults) {
		const quali = qualiResults.find(
			(q) => q.circuit_short_name === race.circuit_short_name && q.year === race.year
		);

		for (const [team, driverNums] of teamDrivers) {
			const ts = teamStats.get(team);
			if (!ts) continue;

			for (const driverNum of driverNums) {
				const inQuali = quali?.positions.has(driverNum);
				const inRace = race.positions.has(driverNum);

				if (inQuali || inRace) {
					ts.races_started++;
					if (inQuali && !inRace) {
						ts.dnfs++;
					}
				}
			}
		}
	}

	for (const [, ts] of teamStats) {
		ts.dnf_rate = ts.races_started > 0 ? ts.dnfs / ts.races_started : 0;
	}
}

/**
 * Factor 5: Driver Skill Delta vs Teammate (5%) — qualifying head-to-head 2026 only
 */
function calcDriverSkillDelta(
	qualiResults: SessionResult[],
	drivers: Driver[]
): Map<number, DriverStats> {
	const stats = new Map<number, DriverStats>();
	for (const d of drivers) {
		stats.set(d.driver_number, {
			driver_number: d.driver_number,
			team_name: d.team_name,
			teammate_delta: 0,
			teammate_battles_won: 0,
			teammate_battles_total: 0,
			avg_race_delta: 0,
			race_delta_count: 0,
		});
	}

	const teams = new Map<string, Driver[]>();
	for (const d of drivers) {
		if (!teams.has(d.team_name)) teams.set(d.team_name, []);
		teams.get(d.team_name)!.push(d);
	}

	for (const result of qualiResults) {
		for (const [, teammates] of teams) {
			if (teammates.length !== 2) continue;
			const [d1, d2] = teammates;
			const pos1 = result.positions.get(d1.driver_number);
			const pos2 = result.positions.get(d2.driver_number);
			if (pos1 === undefined || pos2 === undefined) continue;

			const s1 = stats.get(d1.driver_number)!;
			const s2 = stats.get(d2.driver_number)!;

			s1.teammate_battles_total++;
			s2.teammate_battles_total++;

			if (pos1 < pos2) {
				s1.teammate_battles_won++;
				s1.teammate_delta -= 1;
				s2.teammate_delta += 1;
			} else {
				s2.teammate_battles_won++;
				s2.teammate_delta -= 1;
				s1.teammate_delta += 1;
			}
		}
	}

	return stats;
}

/** Compute avg race delta (grid -> finish) for race predictions */
function calcRacePaceDelta(
	qualiResults: SessionResult[],
	raceResults: SessionResult[],
	driverStats: Map<number, DriverStats>
): void {
	for (const race of raceResults) {
		const quali = qualiResults.find(
			(q) => q.circuit_short_name === race.circuit_short_name && q.year === race.year
		);
		if (!quali) continue;

		for (const [driverNum, racePos] of race.positions) {
			const qualiPos = quali.positions.get(driverNum);
			const ds = driverStats.get(driverNum);
			if (qualiPos === undefined || !ds) continue;

			const delta = qualiPos - racePos; // positive = gained positions in race
			ds.avg_race_delta =
				(ds.avg_race_delta * ds.race_delta_count + delta) / (ds.race_delta_count + 1);
			ds.race_delta_count++;
		}
	}
}

// ============ SCORING ============

const BASE_WEIGHTS = {
	seasonTrend: 0.4,
	teamPerformance: 0.35,
	trackHistory: 0.1,
	reliability: 0.1,
	driverSkill: 0.05,
};

/** If fewer than 3 2026 races at this circuit, reduce track history and boost season trend */
function resolveWeights(racesAtCircuit: number) {
	if (racesAtCircuit >= 3) return { ...BASE_WEIGHTS };
	// Scale track history linearly: 0 races = 0%, 1 = 3.3%, 2 = 6.7%
	const trackScale = racesAtCircuit / 3;
	const trackWeight = BASE_WEIGHTS.trackHistory * trackScale;
	const redistributed = BASE_WEIGHTS.trackHistory - trackWeight;
	return {
		seasonTrend: BASE_WEIGHTS.seasonTrend + redistributed,
		teamPerformance: BASE_WEIGHTS.teamPerformance,
		trackHistory: trackWeight,
		reliability: BASE_WEIGHTS.reliability,
		driverSkill: BASE_WEIGHTS.driverSkill,
	};
}

function scoreDrivers(
	drivers: Driver[],
	teamStats: Map<string, TeamStats>,
	driverStats: Map<number, DriverStats>,
	seasonTrend: Map<number, { score: number; detail: string }>,
	trackHistory: Map<number, { avgPos: number; count: number }>,
	weights: ReturnType<typeof resolveWeights>,
	intelligenceFactors: IntelligenceFactor[] = []
): PredictedPosition[] {
	const maxPos = 20;
	const scores: {
		driver_number: number;
		driver: Driver | null;
		total_score: number;
		factors: FactorBreakdown[];
		reliability_warning: boolean;
		dnf_rate: number;
		expected_race_delta: number;
	}[] = [];

	for (const d of drivers) {
		const ts = teamStats.get(d.team_name);
		const ds = driverStats.get(d.driver_number);
		const trend = seasonTrend.get(d.driver_number);
		const th = trackHistory.get(d.driver_number);
		const factors: FactorBreakdown[] = [];
		let totalScore = 0;

		// Factor 1: Season Trend (40%)
		const trendAvg = trend?.score ?? 10;
		const trendScore = (maxPos + 1 - Math.min(trendAvg, maxPos)) / maxPos;
		const trendContrib = trendScore * weights.seasonTrend;
		totalScore += trendContrib;
		factors.push({
			name: 'Season Trend',
			weight: Math.round(weights.seasonTrend * 100),
			value: trendContrib,
			detail: trend?.detail ?? 'No recent race data',
		});

		// Factor 2: Car/Team Performance (35%)
		const teamAvg = ts?.avg_quali_position ?? 10;
		const teamScore = (maxPos + 1 - Math.min(teamAvg, maxPos)) / maxPos;
		const teamContrib = teamScore * weights.teamPerformance;
		totalScore += teamContrib;
		factors.push({
			name: 'Car/Team Performance',
			weight: Math.round(weights.teamPerformance * 100),
			value: teamContrib,
			detail: `Avg 2026 quali P${teamAvg.toFixed(1)}`,
		});

		// Factor 3: Track History 2026 (10% or reduced)
		const histAvg = th?.avgPos ?? 10;
		const histCount = th?.count ?? 0;
		const histScore = (maxPos + 1 - Math.min(histAvg, maxPos)) / maxPos;
		const histContrib = histScore * weights.trackHistory;
		totalScore += histContrib;
		factors.push({
			name: 'Track History (2026)',
			weight: Math.round(weights.trackHistory * 100),
			value: histContrib,
			detail:
				histCount > 0
					? `Avg P${histAvg.toFixed(1)} at this track in 2026 (${histCount} sessions)`
					: 'No 2026 circuit data — weight redistributed to season trend',
		});

		// Factor 4: Reliability + ERS (10%)
		const dnfRate = ts?.dnf_rate ?? 0;
		const reliabilityScore = 1 - dnfRate;
		const reliabilityContrib = reliabilityScore * weights.reliability;
		totalScore += reliabilityContrib;
		factors.push({
			name: 'Reliability + ERS',
			weight: Math.round(weights.reliability * 100),
			value: reliabilityContrib,
			detail:
				ts && ts.races_started > 0
					? `${ts.dnfs} DNFs in ${ts.races_started} starts (${(dnfRate * 100).toFixed(0)}% — incl. ERS/hybrid failures)`
					: 'No reliability data',
		});

		// Factor 5: Driver Skill Delta (5%)
		const delta = ds?.teammate_delta ?? 0;
		const battles = ds?.teammate_battles_total ?? 0;
		const skillScore = battles > 0 ? Math.max(0, Math.min(1, 0.5 - delta / (battles * 2))) : 0.5;
		const skillContrib = skillScore * weights.driverSkill;
		totalScore += skillContrib;
		const wonBattles = ds?.teammate_battles_won ?? 0;
		factors.push({
			name: 'Driver Skill',
			weight: Math.round(weights.driverSkill * 100),
			value: skillContrib,
			detail:
				battles > 0
					? `${wonBattles}/${battles} teammate battles won`
					: 'No head-to-head data',
		});

		// Factor 6: Intelligence Factors (adjustment layer)
		if (intelligenceFactors.length > 0) {
			const adj = calcFactorAdjustments(intelligenceFactors, d.team_name);
			const totalAdj = adj.reliability + adj.car_performance + adj.recent_form;

			if (adj.applied.length > 0) {
				totalScore += totalAdj;

				const details: string[] = [];
				if (adj.car_performance !== 0) details.push(`car ${adj.car_performance > 0 ? '+' : ''}${adj.car_performance.toFixed(3)}`);
				if (adj.reliability !== 0) details.push(`rel ${adj.reliability > 0 ? '+' : ''}${adj.reliability.toFixed(3)}`);
				if (adj.recent_form !== 0) details.push(`form ${adj.recent_form > 0 ? '+' : ''}${adj.recent_form.toFixed(3)}`);

				factors.push({
					name: 'Intel Factors',
					weight: 0, // adjustment layer, not a weighted component
					value: totalAdj,
					detail: `${adj.applied.length} factor(s): ${details.join(', ')} | ${adj.applied.map(f => f.factor_type).join(', ')}`,
				});
			}
		}

		scores.push({
			driver_number: d.driver_number,
			driver: d,
			total_score: totalScore,
			factors,
			reliability_warning: dnfRate > 0.2,
			dnf_rate: dnfRate,
			expected_race_delta: ds?.avg_race_delta ?? 0,
		});
	}

	scores.sort((a, b) => b.total_score - a.total_score);

	const maxScore = scores[0]?.total_score ?? 1;
	return scores.map((s, i) => {
		const scorePct = maxScore > 0 ? (s.total_score / maxScore) * 100 : 50;
		const dataFactors = s.factors.filter((f) => !f.detail.includes('No ')).length;
		const dataPct = (dataFactors / 5) * 100;
		const confidence = Math.round(Math.max(5, Math.min(95, scorePct * 0.6 + dataPct * 0.4)));

		return {
			driver_number: s.driver_number,
			driver: s.driver,
			predicted_position: i + 1,
			confidence,
			factors: s.factors,
			reliability_warning: s.reliability_warning,
			dnf_rate: s.dnf_rate,
			expected_race_delta: s.expected_race_delta,
		};
	});
}

// ============ PUBLIC API ============

export async function predictPreQuali(
	circuitShortName: string,
	currentYear: number,
	currentDrivers: Driver[]
): Promise<StagePrediction> {
	const notes: string[] = [];

	const [{ qualiResults, raceResults }, intelligenceFactors] = await Promise.all([
		collect2026Data(),
		fetchIntelligenceFactors(),
	]);
	notes.push(`Analyzed ${qualiResults.length} qualifying sessions, ${raceResults.length} races from 2026`);
	notes.push('2026 regs: No DRS — Active Aero + Overtake Mode (electric boost within 1s)');
	notes.push('50/50 ICE/electric split — MGU-H removed, new ERS failure modes');

	const teamStats = calcTeamPerformance(qualiResults, currentDrivers);
	const driverStats = calcDriverSkillDelta(qualiResults, currentDrivers);
	calcRacePaceDelta(qualiResults, raceResults, driverStats);
	calcReliability(qualiResults, raceResults, teamStats, currentDrivers);
	const seasonTrend = calcSeasonTrend(raceResults, currentDrivers);

	const { history: trackHistory, racesAtCircuit } = calcTrackHistory2026(
		raceResults, qualiResults, circuitShortName, currentDrivers
	);
	const weights = resolveWeights(racesAtCircuit);

	if (racesAtCircuit < 3) {
		notes.push(
			`Only ${racesAtCircuit} 2026 race(s) at ${circuitShortName} — track history weight reduced to ${Math.round(weights.trackHistory * 100)}%, extra weight to season trend`
		);
	}

	for (const [team, ts] of teamStats) {
		if (ts.dnf_rate > 0.2) {
			notes.push(`⚠ ${team}: ${(ts.dnf_rate * 100).toFixed(0)}% DNF rate — ERS/reliability concern`);
		}
	}

	const predictions = scoreDrivers(currentDrivers, teamStats, driverStats, seasonTrend, trackHistory, weights, intelligenceFactors);

	if (intelligenceFactors.length > 0) {
		notes.push(`Intelligence factors: ${intelligenceFactors.length} applied`);
	}

	notes.push(
		`Weights: Season trend ${Math.round(weights.seasonTrend * 100)}% | Car/team ${Math.round(weights.teamPerformance * 100)}% | Track ${Math.round(weights.trackHistory * 100)}% | Reliability ${Math.round(weights.reliability * 100)}% | Driver ${Math.round(weights.driverSkill * 100)}%`
	);

	return { stage: 'pre-quali', predictions, model_notes: notes };
}

export async function predictQualifying(
	circuitShortName: string,
	currentYear: number,
	currentDrivers: Driver[],
	fpSessionKeys: number[]
): Promise<StagePrediction> {
	const notes: string[] = [];

	const [{ qualiResults, raceResults }, intelligenceFactors] = await Promise.all([
		collect2026Data(),
		fetchIntelligenceFactors(),
	]);
	notes.push(`Analyzed ${qualiResults.length} qualifying sessions from 2026`);
	notes.push('2026 regs: Active Aero qualifying — no DRS zones');

	const teamStats = calcTeamPerformance(qualiResults, currentDrivers);
	const driverStats = calcDriverSkillDelta(qualiResults, currentDrivers);
	calcRacePaceDelta(qualiResults, raceResults, driverStats);
	calcReliability(qualiResults, raceResults, teamStats, currentDrivers);
	const seasonTrend = calcSeasonTrend(raceResults, currentDrivers);

	const { history: trackHistory, racesAtCircuit } = calcTrackHistory2026(
		raceResults, qualiResults, circuitShortName, currentDrivers
	);
	const weights = resolveWeights(racesAtCircuit);

	if (racesAtCircuit < 3) {
		notes.push(
			`Only ${racesAtCircuit} 2026 race(s) at ${circuitShortName} — track history weight reduced`
		);
	}

	for (const [team, ts] of teamStats) {
		if (ts.dnf_rate > 0.2) {
			notes.push(`⚠ ${team}: ${(ts.dnf_rate * 100).toFixed(0)}% DNF rate — ERS/reliability concern`);
		}
	}

	const predictions = scoreDrivers(currentDrivers, teamStats, driverStats, seasonTrend, trackHistory, weights, intelligenceFactors);

	if (intelligenceFactors.length > 0) {
		notes.push(`Intelligence factors: ${intelligenceFactors.length} applied`);
	}

	const q1Dropouts = predictions.slice(15);
	const q2Dropouts = predictions.slice(10, 15);

	notes.push('Q1 cutoff: P16-P20, Q2 cutoff: P11-P15');

	return {
		stage: 'qualifying',
		predictions,
		q1_dropouts: q1Dropouts,
		q2_dropouts: q2Dropouts,
		model_notes: notes,
	};
}

export async function predictRace(
	circuitShortName: string,
	currentYear: number,
	currentDrivers: Driver[],
	gridPositions: Map<number, number>
): Promise<StagePrediction> {
	const notes: string[] = [];
	const overtakingFactor = CIRCUIT_OVERTAKING[circuitShortName] ?? 0.6;

	const [{ qualiResults, raceResults }, intelligenceFactors] = await Promise.all([
		collect2026Data(),
		fetchIntelligenceFactors(),
	]);
	notes.push(`Analyzed ${raceResults.length} races, ${qualiResults.length} qualifyings from 2026`);
	notes.push('2026 regs: Overtake Mode replaces DRS — electric boost within 1s of car ahead');

	const teamStats = calcTeamPerformance(qualiResults, currentDrivers);
	const driverStats = calcDriverSkillDelta(qualiResults, currentDrivers);
	calcRacePaceDelta(qualiResults, raceResults, driverStats);
	calcReliability(qualiResults, raceResults, teamStats, currentDrivers);
	const seasonTrend = calcSeasonTrend(raceResults, currentDrivers);

	const { history: trackHistory, racesAtCircuit } = calcTrackHistory2026(
		raceResults, qualiResults, circuitShortName, currentDrivers
	);
	const weights = resolveWeights(racesAtCircuit);

	if (racesAtCircuit < 3) {
		notes.push(
			`Only ${racesAtCircuit} 2026 race(s) at ${circuitShortName} — track history weight reduced`
		);
	}

	notes.push(
		`Overtaking factor: ${overtakingFactor.toFixed(1)}x (${overtakingFactor < 0.4 ? 'very hard' : overtakingFactor < 0.7 ? 'hard' : overtakingFactor > 1.0 ? 'easy' : 'medium'} — Active Aero)`
	);

	for (const [team, ts] of teamStats) {
		if (ts.dnf_rate > 0.2) {
			notes.push(`⚠ ${team}: ${(ts.dnf_rate * 100).toFixed(0)}% DNF rate — ERS/reliability concern`);
		}
	}

	const predictions = scoreDrivers(currentDrivers, teamStats, driverStats, seasonTrend, trackHistory, weights, intelligenceFactors);

	if (intelligenceFactors.length > 0) {
		notes.push(`Intelligence factors: ${intelligenceFactors.length} applied`);
	}

	// Calculate position changes from grid
	for (const pred of predictions) {
		const gridPos = gridPositions.get(pred.driver_number);
		if (gridPos !== undefined) {
			pred.position_change = gridPos - pred.predicted_position;
		}
	}

	const expectedMovers = predictions
		.filter((p) => p.position_change !== undefined && Math.abs(p.position_change!) >= 2)
		.map((p) => ({ ...p }))
		.sort((a, b) => Math.abs(b.position_change ?? 0) - Math.abs(a.position_change ?? 0));

	notes.push(
		`Weights: Season trend ${Math.round(weights.seasonTrend * 100)}% | Car/team ${Math.round(weights.teamPerformance * 100)}% | Track ${Math.round(weights.trackHistory * 100)}% | Reliability ${Math.round(weights.reliability * 100)}% | Driver ${Math.round(weights.driverSkill * 100)}%`
	);

	return {
		stage: 'race',
		predictions,
		expected_movers: expectedMovers,
		model_notes: notes,
	};
}

// ============ HELPERS ============

export function getActiveStage(sessions: Session[]): 'pre-quali' | 'qualifying' | 'race' {
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
