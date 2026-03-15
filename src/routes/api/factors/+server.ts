import type { RequestHandler } from "./$types";

const FACTORS_URL = "https://openf1-api.sliplane.app/v1/factors";
const CACHE_TTL = 30_000;

let cached: { data: string; timestamp: number } | null = null;

export const GET: RequestHandler = async () => {
	const now = Date.now();

	if (cached && now - cached.timestamp < CACHE_TTL) {
		return new Response(cached.data, {
			headers: { "Content-Type": "application/json", "X-Cache": "HIT" },
		});
	}

	try {
		const res = await fetch(FACTORS_URL, { signal: AbortSignal.timeout(5000) });
		if (res.ok) {
			const text = await res.text();
			if (text.trim() && text.trim() !== "[]") {
				cached = { data: text, timestamp: now };
				return new Response(text, {
					headers: { "Content-Type": "application/json", "X-Cache": "MISS" },
				});
			}
		}
	} catch {
		// API not available — fall through to empty response
	}

	const empty = "[]";
	cached = { data: empty, timestamp: now };
	return new Response(empty, {
		headers: { "Content-Type": "application/json", "X-Cache": "MISS", "X-Source": "fallback-empty" },
	});
};
