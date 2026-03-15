import { getSessions, getPositions } from './api';
import type { Session, Driver } from './api';

// Circuit overtaking difficulty multiplier
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

/** Collect all 2026 qualifying and race results */
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

/** Collect historical data for a specific circuit */
async function collectCircuitHistory(
	circuitShortName: string,
	years: number[]
): Promise<{ qualiResults: SessionResult[]; raceResults: SessionResult[] }> {
	const qualiResults: SessionResult[] = [];
	const raceResults: SessionResult[] = [];

	for (const year of years) {
		try {
			const sessions = await getSessions({ circuit_short_name: circuitShortName, year });
			const qualiSession = sessions.find(
				(s) => s.session_type === 'Qualifying' || s.session_name?.includes('Qualifying')
			);
			const raceSession = sessions.find(
				(s) => s.session_type === 'Race' || s.session_name === 'Race'
			);

			if (qualiSession) {
				const positions = await getSessionResults(qualiSession.session_key);
				if (positions.size > 0) {
					qualiResults.push({
						session_key: qualiSession.session_key,
						session_type: 'Qualifying',
						circuit_short_name: circuitShortName,
						year,
						positions,
					});
				}
			}
			if (raceSession) {
				const positions = await getSessionResults(raceSession.session_key);
				if (positions.size > 0) {
					raceResults.push({
						session_key: raceSession.session_key,
						session_type: 'Race',
						circuit_short_name: raceSession.circuit_short_name,
						year,
						positions,
					});
				}
			}
		} catch {
			// Year might not have data
		}
	}

	return { qualiResults, raceResults };
}

// ============ FACTOR CALCULATIONS ============

/** Factor 1: Team Performance (50%) — avg qualifying position across all 2026 sessions */
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

/** Factor 2: Driver Skill Delta (15%) — teammate head-to-head in qualifying */
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

/** Factor 3: Race Pace vs Grid (15%) — avg positions gained/lost from grid to finish */
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

/** Factor 4: Reliability (10%) — DNF rate per team */
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

/** Factor 5: Circuit History (10%) — same team at same track in 2024/2025 */
function calcCircuitHistory(
	historyResults: SessionResult[],
	drivers: Driver[]
): Map<number, { avgPos: number; count: number }> {
	const history = new Map<number, { total: number; count: number }>();

	for (const result of historyResults) {
		for (const [driverNum, pos] of result.positions) {
			const existing = history.get(driverNum) ?? { total: 0, count: 0 };
			existing.total += pos;
			existing.count++;
			history.set(driverNum, existing);
		}
	}

	// Also map by team — if driver wasn't there but team was, use team average
	const teamHistory = new Map<string, { total: number; count: number }>();
	for (const result of historyResults) {
		for (const [driverNum, pos] of result.positions) {
			const driver = drivers.find((d) => d.driver_number === driverNum);
			if (driver) {
				const existing = teamHistory.get(driver.team_name) ?? { total: 0, count: 0 };
				existing.total += pos;
				existing.count++;
				teamHistory.set(driver.team_name, existing);
			}
		}
	}

	const result = new Map<number, { avgPos: number; count: number }>();
	for (const d of drivers) {
		const personal = history.get(d.driver_number);
		if (personal && personal.count > 0) {
			result.set(d.driver_number, {
				avgPos: personal.total / personal.count,
				count: personal.count,
			});
		} else {
			const team = teamHistory.get(d.team_name);
			if (team && team.count > 0) {
				result.set(d.driver_number, {
					avgPos: team.total / team.count,
					count: team.count,
				});
			}
		}
	}

	return result;
}

// ============ SCORING ============

const WEIGHTS = {
	teamPerformance: 0.5,
	driverSkill: 0.15,
	racePace: 0.15,
	reliability: 0.1,
	circuitHistory: 0.1,
};

function scoreDrivers(
	drivers: Driver[],
	teamStats: Map<string, TeamStats>,
	driverStats: Map<number, DriverStats>,
	circuitHistory: Map<number, { avgPos: number; count: number }>
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
		const ch = circuitHistory.get(d.driver_number);
		const factors: FactorBreakdown[] = [];
		let totalScore = 0;

		// Factor 1: Team Performance (50%)
		const teamAvg = ts?.avg_quali_position ?? 10;
		const teamScore = (maxPos + 1 - Math.min(teamAvg, maxPos)) / maxPos;
		const teamContrib = teamScore * WEIGHTS.teamPerformance;
		totalScore += teamContrib;
		factors.push({
			name: 'Team Performance',
			weight: 50,
			value: teamContrib,
			detail: `Avg quali P${teamAvg.toFixed(1)}`,
		});

		// Factor 2: Driver Skill Delta (15%)
		const delta = ds?.teammate_delta ?? 0;
		const battles = ds?.teammate_battles_total ?? 0;
		const skillScore = battles > 0 ? Math.max(0, Math.min(1, 0.5 - delta / (battles * 2))) : 0.5;
		const skillContrib = skillScore * WEIGHTS.driverSkill;
		totalScore += skillContrib;
		const wonBattles = ds?.teammate_battles_won ?? 0;
		factors.push({
			name: 'Driver Skill',
			weight: 15,
			value: skillContrib,
			detail:
				battles > 0
					? `${wonBattles}/${battles} teammate battles won`
					: 'No head-to-head data',
		});

		// Factor 3: Race Pace vs Grid (15%)
		const raceDelta = ds?.avg_race_delta ?? 0;
		const raceDeltaCount = ds?.race_delta_count ?? 0;
		const racePaceScore = Math.max(0, Math.min(1, 0.5 + raceDelta / 10));
		const racePaceContrib = racePaceScore * WEIGHTS.racePace;
		totalScore += racePaceContrib;
		factors.push({
			name: 'Race Pace vs Grid',
			weight: 15,
			value: racePaceContrib,
			detail:
				raceDeltaCount > 0
					? `Avg ${raceDelta >= 0 ? '+' : ''}${raceDelta.toFixed(1)} positions`
					: 'No race data',
		});

		// Factor 4: Reliability (10%)
		const dnfRate = ts?.dnf_rate ?? 0;
		const reliabilityScore = 1 - dnfRate;
		const reliabilityContrib = reliabilityScore * WEIGHTS.reliability;
		totalScore += reliabilityContrib;
		factors.push({
			name: 'Reliability',
			weight: 10,
			value: reliabilityContrib,
			detail:
				ts && ts.races_started > 0
					? `${ts.dnfs} DNFs in ${ts.races_started} starts (${(dnfRate * 100).toFixed(0)}%)`
					: 'No reliability data',
		});

		// Factor 5: Circuit History (10%)
		const histAvg = ch?.avgPos ?? 10;
		const histCount = ch?.count ?? 0;
		const histScore = (maxPos + 1 - Math.min(histAvg, maxPos)) / maxPos;
		const histContrib = histScore * WEIGHTS.circuitHistory;
		totalScore += histContrib;
		factors.push({
			name: 'Circuit History',
			weight: 10,
			value: histContrib,
			detail:
				histCount > 0
					? `Avg P${histAvg.toFixed(1)} at this track (${histCount} sessions)`
					: 'No circuit history',
		});

		scores.push({
			driver_number: d.driver_number,
			driver: d,
			total_score: totalScore,
			factors,
			reliability_warning: dnfRate > 0.2,
			dnf_rate: dnfRate,
			expected_race_delta: raceDelta,
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

	const { qualiResults, raceResults } = await collect2026Data();
	notes.push(`Analyzed ${qualiResults.length} qualifying sessions, ${raceResults.length} races from 2026`);

	const teamStats = calcTeamPerformance(qualiResults, currentDrivers);
	const driverStats = calcDriverSkillDelta(qualiResults, currentDrivers);
	calcRacePaceDelta(qualiResults, raceResults, driverStats);
	calcReliability(qualiResults, raceResults, teamStats, currentDrivers);

	const { qualiResults: histQuali } = await collectCircuitHistory(circuitShortName, [
		currentYear - 1,
		currentYear - 2,
	]);
	const circuitHistory = calcCircuitHistory(histQuali, currentDrivers);
	if (histQuali.length > 0) {
		notes.push(`Circuit history: ${histQuali.length} sessions from 2024-2025`);
	}

	for (const [team, ts] of teamStats) {
		if (ts.dnf_rate > 0.2) {
			notes.push(`${team}: ${(ts.dnf_rate * 100).toFixed(0)}% DNF rate — reliability concern`);
		}
	}

	const predictions = scoreDrivers(currentDrivers, teamStats, driverStats, circuitHistory);

	notes.push('Weights: Team 50% | Driver 15% | Race pace 15% | Reliability 10% | Circuit 10%');

	return { stage: 'pre-quali', predictions, model_notes: notes };
}

export async function predictQualifying(
	circuitShortName: string,
	currentYear: number,
	currentDrivers: Driver[],
	fpSessionKeys: number[]
): Promise<StagePrediction> {
	const notes: string[] = [];

	const { qualiResults, raceResults } = await collect2026Data();
	notes.push(`Analyzed ${qualiResults.length} qualifying sessions from 2026`);

	const teamStats = calcTeamPerformance(qualiResults, currentDrivers);
	const driverStats = calcDriverSkillDelta(qualiResults, currentDrivers);
	calcRacePaceDelta(qualiResults, raceResults, driverStats);
	calcReliability(qualiResults, raceResults, teamStats, currentDrivers);

	const { qualiResults: histQuali } = await collectCircuitHistory(circuitShortName, [
		currentYear - 1,
		currentYear - 2,
	]);
	const circuitHistory = calcCircuitHistory(histQuali, currentDrivers);
	if (histQuali.length > 0) {
		notes.push(`Circuit history: ${histQuali.length} sessions from 2024-2025`);
	}

	for (const [team, ts] of teamStats) {
		if (ts.dnf_rate > 0.2) {
			notes.push(`${team}: ${(ts.dnf_rate * 100).toFixed(0)}% DNF rate — reliability concern`);
		}
	}

	const predictions = scoreDrivers(currentDrivers, teamStats, driverStats, circuitHistory);

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

	const { qualiResults, raceResults } = await collect2026Data();
	notes.push(`Analyzed ${raceResults.length} races, ${qualiResults.length} qualifyings from 2026`);

	const teamStats = calcTeamPerformance(qualiResults, currentDrivers);
	const driverStats = calcDriverSkillDelta(qualiResults, currentDrivers);
	calcRacePaceDelta(qualiResults, raceResults, driverStats);
	calcReliability(qualiResults, raceResults, teamStats, currentDrivers);

	const { qualiResults: histQuali, raceResults: histRace } = await collectCircuitHistory(
		circuitShortName,
		[currentYear - 1, currentYear - 2]
	);
	const circuitHistory = calcCircuitHistory(
		histRace.length > 0 ? histRace : histQuali,
		currentDrivers
	);
	if (histRace.length > 0 || histQuali.length > 0) {
		notes.push(`Circuit history: ${histRace.length + histQuali.length} sessions from 2024-2025`);
	}

	notes.push(
		`Overtaking difficulty: ${overtakingFactor.toFixed(1)}x (${overtakingFactor < 0.5 ? 'hard' : overtakingFactor > 1.0 ? 'easy' : 'medium'})`
	);

	for (const [team, ts] of teamStats) {
		if (ts.dnf_rate > 0.2) {
			notes.push(`${team}: ${(ts.dnf_rate * 100).toFixed(0)}% DNF rate — reliability concern`);
		}
	}

	const predictions = scoreDrivers(currentDrivers, teamStats, driverStats, circuitHistory);

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

	notes.push('Weights: Team 50% | Driver 15% | Race pace 15% | Reliability 10% | Circuit 10%');

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
