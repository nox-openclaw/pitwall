import type { RequestHandler } from "./$types";

const FACTORS_URL = "https://openf1-api.sliplane.app:8001/v1/factors";
const CACHE_TTL = 1_800_000; // 30 minutes — factors don't change often

const cache = new Map<string, { data: string; timestamp: number }>();

export const GET: RequestHandler = async ({ url }) => {
	const now = Date.now();

	// Build upstream URL with query params
	const upstream = new URL(FACTORS_URL);
	for (const [key, value] of url.searchParams) {
		upstream.searchParams.set(key, value);
	}
	const cacheKey = upstream.toString();

	const hit = cache.get(cacheKey);
	if (hit && now - hit.timestamp < CACHE_TTL) {
		return new Response(hit.data, {
			headers: { "Content-Type": "application/json", "X-Cache": "HIT" },
		});
	}

	try {
		const res = await fetch(upstream.toString(), { signal: AbortSignal.timeout(5000) });
		if (res.ok) {
			const text = await res.text();
			cache.set(cacheKey, { data: text, timestamp: now });
			return new Response(text, {
				headers: { "Content-Type": "application/json", "X-Cache": "MISS" },
			});
		}
	} catch {
		// API not available — fall through to empty response
	}

	return new Response("[]", {
		headers: { "Content-Type": "application/json", "X-Cache": "MISS", "X-Source": "fallback-empty" },
	});
};
