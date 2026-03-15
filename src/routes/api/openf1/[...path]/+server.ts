import type { RequestHandler } from "./$types";

const PRIMARY = process.env.OPENF1_API_URL ?? "https://openf1-api.sliplane.app/v1";
const FALLBACK = "https://api.openf1.org/v1";
const CACHE_TTL = 10_000;

const cache = new Map<string, { data: string; timestamp: number }>();

async function fetchUpstream(base: string, path: string, params: URLSearchParams): Promise<{ data: string; ok: boolean }> {
	try {
		const upstream = new URL(`${base}/${path}`);
		params.forEach((v, k) => upstream.searchParams.set(k, v));
		const res = await fetch(upstream.toString(), { signal: AbortSignal.timeout(5000) });
		if (!res.ok) return { data: "[]", ok: false };
		const text = await res.text();
		// Fallback if empty array
		if (text.trim() === "[]" || text.trim() === "") return { data: text, ok: false };
		return { data: text, ok: true };
	} catch {
		return { data: "[]", ok: false };
	}
}

export const GET: RequestHandler = async ({ params, url }) => {
	const cacheKey = `${params.path}?${url.searchParams.toString()}`;
	const now = Date.now();
	const cached = cache.get(cacheKey);

	if (cached && now - cached.timestamp < CACHE_TTL) {
		return new Response(cached.data, {
			headers: { "Content-Type": "application/json", "X-Cache": "HIT" }
		});
	}

	let { data, ok } = await fetchUpstream(PRIMARY, params.path, url.searchParams);

	if (!ok) {
		const fallback = await fetchUpstream(FALLBACK, params.path, url.searchParams);
		data = fallback.data;
	}

	cache.set(cacheKey, { data, timestamp: now });

	return new Response(data, {
		headers: { "Content-Type": "application/json", "X-Cache": "MISS", "X-Source": ok ? "primary" : "fallback" }
	});
};
