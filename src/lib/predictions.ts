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

interface HistoricalResult {
	year: number;
	session_type: string;
	driver_number: number;
	position: number;
}

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
		// Get the last recorded position for each driver (final result)
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

// ============ STAGE 1: PRE-QUALIFYING PREDICTION ============

export async function predictPreQuali(
	circuitShortName: string,
	currentYear: number,
	currentDrivers: Driver[]
): Promise<StagePrediction> {
	const notes: string[] = [];
	const driverScores = new Map<number, { score: number; factors: string[]; count: number }>();

	// Initialize all current drivers
	for (const d of currentDrivers) {
		driverScores.set(d.driver_number, { score: 0, factors: [], count: 0 });
	}

	// Factor 1: Historical results at this circuit (last 3 years)
	const historicalYears = [currentYear - 1, currentYear - 2, currentYear - 3];
	const historicalSessions = await getHistoricalSessions(circuitShortName, historicalYears);

	const qualiSessions = historicalSessions.filter(
		(s) => s.session_type === 'Qualifying' || s.session_name?.includes('Qualifying')
	);
	const raceSessions = historicalSessions.filter(
		(s) => s.session_type === 'Race' || s.session_name?.includes('Race')
	);

	let historicalDataFound = false;

	for (const session of qualiSessions) {
		const results = await getSessionResults(session.session_key);
		if (results.size > 0) historicalDataFound = true;
		for (const [driverNum, pos] of results) {
			const entry = driverScores.get(driverNum);
			if (entry) {
				// Weight: lower position = better score. Normalize to 0-20 scale (P1=20, P20=1)
				entry.score += (21 - Math.min(pos, 20)) * 1.5;
				entry.count++;
				entry.factors.push(`P${pos} quali ${session.year}`);
			}
		}
	}

	if (historicalDataFound) {
		notes.push(`Found ${qualiSessions.length} historical qualifying sessions`);
	}

	// Factor 2: Recent form — last 3 race sessions of current year
	try {
		const recentSessions = await getSessions({ year: currentYear, session_type: 'Race' });
		const lastThreeRaces = recentSessions.slice(-3);

		for (const session of lastThreeRaces) {
			const results = await getSessionResults(session.session_key);
			for (const [driverNum, pos] of results) {
				const entry = driverScores.get(driverNum);
				if (entry) {
					entry.score += (21 - Math.min(pos, 20)) * 2.0; // Recent form weighted higher
					entry.count++;
					entry.factors.push(`P${pos} ${session.circuit_short_name}`);
				}
			}
		}

		if (lastThreeRaces.length > 0) {
			notes.push(`Analyzed ${lastThreeRaces.length} recent races for form`);
		}
	} catch {
		notes.push('No recent race data available');
	}

	// Factor 3: Qualifying teammate battles (from recent qualis)
	try {
		const recentQualis = await getSessions({ year: currentYear, session_type: 'Qualifying' });
		const lastThreeQualis = recentQualis.slice(-3);

		// Group drivers by team
		const teams = new Map<string, Driver[]>();
		for (const d of currentDrivers) {
			const team = d.team_name;
			if (!teams.has(team)) teams.set(team, []);
			teams.get(team)!.push(d);
		}

		for (const session of lastThreeQualis) {
			const results = await getSessionResults(session.session_key);
			for (const [, teammates] of teams) {
				if (teammates.length === 2) {
					const pos1 = results.get(teammates[0].driver_number);
					const pos2 = results.get(teammates[1].driver_number);
					if (pos1 !== undefined && pos2 !== undefined) {
						// Bonus to teammate who out-qualified
						const winner = pos1 < pos2 ? teammates[0] : teammates[1];
						const entry = driverScores.get(winner.driver_number);
						if (entry) {
							entry.score += 3;
							entry.factors.push('Teammate quali edge');
						}
					}
				}
			}
		}
	} catch {
		// Skip teammate analysis if data unavailable
	}

	// Build predictions from scores
	const predictions = buildPredictions(driverScores, currentDrivers);
	notes.push('Confidence based on data volume and consistency');

	return { stage: 'pre-quali', predictions, model_notes: notes };
}

// ============ STAGE 2: QUALIFYING PREDICTION ============

export async function predictQualifying(
	circuitShortName: string,
	currentYear: number,
	currentDrivers: Driver[],
	fpSessionKeys: number[] // FP1, FP2, FP3 session keys
): Promise<StagePrediction> {
	const notes: string[] = [];
	const driverScores = new Map<number, { score: number; factors: string[]; count: number }>();

	for (const d of currentDrivers) {
		driverScores.set(d.driver_number, { score: 0, factors: [], count: 0 });
	}

	// Factor 1: FP pace analysis
	const allFpTimes = new Map<number, number[]>();
	let fpDataFound = false;

	for (const fpKey of fpSessionKeys) {
		const fastest = await getFastestLaps(fpKey);
		if (fastest.size > 0) fpDataFound = true;
		for (const [driverNum, time] of fastest) {
			if (!allFpTimes.has(driverNum)) allFpTimes.set(driverNum, []);
			allFpTimes.get(driverNum)!.push(time);
		}
	}

	if (fpDataFound) {
		// Calculate best FP time per driver
		const bestTimes = new Map<number, number>();
		for (const [driverNum, times] of allFpTimes) {
			bestTimes.set(driverNum, Math.min(...times));
		}

		// Sort by best time and assign scores
		const sorted = [...bestTimes.entries()].sort((a, b) => a[1] - b[1]);
		const fastestTime = sorted[0]?.[1] ?? 0;

		for (let i = 0; i < sorted.length; i++) {
			const [driverNum, time] = sorted[i];
			const gap = time - fastestTime;
			const entry = driverScores.get(driverNum);
			if (entry) {
				entry.score += (21 - (i + 1)) * 3; // Heavy weight on FP pace
				entry.count++;
				entry.factors.push(`FP best: +${gap.toFixed(3)}s`);
			}
		}

		notes.push(`Analyzed ${fpSessionKeys.length} practice session(s)`);
	}

	// Factor 2: Historical qualifying at this circuit
	const historicalYears = [currentYear - 1, currentYear - 2];
	const historicalSessions = await getHistoricalSessions(circuitShortName, historicalYears);
	const qualiSessions = historicalSessions.filter(
		(s) => s.session_type === 'Qualifying' || s.session_name?.includes('Qualifying')
	);

	for (const session of qualiSessions) {
		const results = await getSessionResults(session.session_key);
		for (const [driverNum, pos] of results) {
			const entry = driverScores.get(driverNum);
			if (entry) {
				entry.score += (21 - Math.min(pos, 20));
				entry.count++;
				entry.factors.push(`Historical Q: P${pos} (${session.year})`);
			}
		}
	}

	const predictions = buildPredictions(driverScores, currentDrivers);

	// Determine Q1/Q2/Q3 dropouts
	const q1Dropouts = predictions.slice(15); // P16-P20 eliminated in Q1
	const q2Dropouts = predictions.slice(10, 15); // P11-P15 eliminated in Q2

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
	gridPositions: Map<number, number> // driver_number -> grid position (from quali)
): Promise<StagePrediction> {
	const notes: string[] = [];
	const overtakingFactor = CIRCUIT_OVERTAKING[circuitShortName] ?? 0.6;
	const driverScores = new Map<number, { score: number; factors: string[]; count: number }>();

	for (const d of currentDrivers) {
		driverScores.set(d.driver_number, { score: 0, factors: [], count: 0 });
	}

	// Factor 1: Grid position (weighted by overtaking difficulty)
	// At high-overtaking circuits, grid matters less
	const gridWeight = 3.0 - overtakingFactor * 1.5; // Monaco: 2.85, Monza: 0.0
	for (const [driverNum, gridPos] of gridPositions) {
		const entry = driverScores.get(driverNum);
		if (entry) {
			entry.score += (21 - Math.min(gridPos, 20)) * gridWeight;
			entry.count++;
			entry.factors.push(`Grid P${gridPos}`);
		}
	}

	notes.push(`Overtaking difficulty: ${overtakingFactor.toFixed(1)}x (${overtakingFactor < 0.5 ? 'hard' : overtakingFactor > 1.0 ? 'easy' : 'medium'})`);

	// Factor 2: Historical race results at circuit
	const historicalYears = [currentYear - 1, currentYear - 2, currentYear - 3];
	const historicalSessions = await getHistoricalSessions(circuitShortName, historicalYears);
	const raceSessions = historicalSessions.filter(
		(s) => s.session_type === 'Race' || s.session_name?.includes('Race')
	);

	for (const session of raceSessions) {
		const results = await getSessionResults(session.session_key);
		for (const [driverNum, pos] of results) {
			const entry = driverScores.get(driverNum);
			if (entry) {
				entry.score += (21 - Math.min(pos, 20)) * 1.5;
				entry.count++;
				entry.factors.push(`Race P${pos} (${session.year})`);
			}
		}
	}

	// Factor 3: Recent race form
	try {
		const recentRaces = await getSessions({ year: currentYear, session_type: 'Race' });
		const lastThree = recentRaces.slice(-3);
		for (const session of lastThree) {
			const results = await getSessionResults(session.session_key);
			for (const [driverNum, pos] of results) {
				const entry = driverScores.get(driverNum);
				if (entry) {
					entry.score += (21 - Math.min(pos, 20)) * 2.0;
					entry.count++;
					entry.factors.push(`Recent: P${pos} ${session.circuit_short_name}`);
				}
			}
		}
	} catch {
		// No recent data
	}

	// Factor 4: Race vs qualifying delta (who typically gains in races)
	// Compare historical quali vs race positions
	for (const session of raceSessions) {
		const raceResults = await getSessionResults(session.session_key);
		// Find corresponding quali
		const qualiSession = historicalSessions.find(
			(s) =>
				s.year === session.year &&
				(s.session_type === 'Qualifying' || s.session_name?.includes('Qualifying'))
		);
		if (qualiSession) {
			const qualiResults = await getSessionResults(qualiSession.session_key);
			for (const [driverNum, racePos] of raceResults) {
				const qualiPos = qualiResults.get(driverNum);
				const entry = driverScores.get(driverNum);
				if (qualiPos && entry) {
					const posGain = qualiPos - racePos; // positive = gained positions
					entry.score += posGain * overtakingFactor;
					if (Math.abs(posGain) >= 2) {
						entry.factors.push(
							`Race delta: ${posGain > 0 ? '+' : ''}${posGain} (${session.year})`
						);
					}
				}
			}
		}
	}

	const predictions = buildPredictions(driverScores, currentDrivers);

	// Calculate expected movers (compare predicted race position to grid position)
	const expectedMovers: PredictedPosition[] = [];
	for (const pred of predictions) {
		const gridPos = gridPositions.get(pred.driver_number);
		if (gridPos !== undefined) {
			const change = gridPos - pred.predicted_position; // positive = gained
			pred.position_change = change;
			if (Math.abs(change) >= 2) {
				expectedMovers.push({ ...pred });
			}
		}
	}
	expectedMovers.sort((a, b) => Math.abs(b.position_change ?? 0) - Math.abs(a.position_change ?? 0));

	notes.push('Position changes relative to qualifying grid');

	return {
		stage: 'race',
		predictions,
		expected_movers: expectedMovers,
		model_notes: notes,
	};
}

// ============ HELPERS ============

function buildPredictions(
	scores: Map<number, { score: number; factors: string[]; count: number }>,
	drivers: Driver[]
): PredictedPosition[] {
	const driverMap = new Map<number, Driver>();
	for (const d of drivers) driverMap.set(d.driver_number, d);

	const entries = [...scores.entries()]
		.map(([driverNum, data]) => ({
			driver_number: driverNum,
			driver: driverMap.get(driverNum) ?? null,
			score: data.count > 0 ? data.score / data.count : 0,
			rawScore: data.score,
			count: data.count,
			factors: data.factors,
		}))
		.sort((a, b) => b.score - a.score);

	// Assign positions and calculate confidence
	const maxScore = entries[0]?.score ?? 1;
	return entries.map((e, i) => {
		// Confidence based on: data volume + score dominance
		const dataConfidence = Math.min(e.count / 8, 1.0) * 50; // up to 50% from data volume
		const scoreConfidence = maxScore > 0 ? (e.score / maxScore) * 50 : 0; // up to 50% from score
		const confidence = Math.round(Math.max(5, Math.min(95, dataConfidence + scoreConfidence)));

		return {
			driver_number: e.driver_number,
			driver: e.driver,
			predicted_position: i + 1,
			confidence,
			factors: e.factors.slice(0, 5), // Top 5 factors
		};
	});
}

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
