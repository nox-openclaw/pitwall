import type { RequestHandler } from './$types';

const UPSTREAM = 'https://openf1-api.sliplane.app/v1';
const CACHE_TTL = 10_000; // 10 seconds

const cache = new Map<string, { data: ArrayBuffer; headers: Headers; timestamp: number }>();

export const GET: RequestHandler = async ({ params, url }) => {
	const cacheKey = `${params.path}?${url.searchParams.toString()}`;
	const now = Date.now();
	const cached = cache.get(cacheKey);

	if (cached && now - cached.timestamp < CACHE_TTL) {
		return new Response(cached.data, {
			headers: {
				'Content-Type': cached.headers.get('Content-Type') || 'application/json',
				'X-Cache': 'HIT'
			}
		});
	}

	const upstream = new URL(`${UPSTREAM}/${params.path}`);
	url.searchParams.forEach((v, k) => upstream.searchParams.set(k, v));

	const res = await fetch(upstream.toString());
	const data = await res.arrayBuffer();

	cache.set(cacheKey, { data, headers: res.headers, timestamp: now });

	return new Response(data, {
		status: res.status,
		headers: {
			'Content-Type': res.headers.get('Content-Type') || 'application/json',
			'X-Cache': 'MISS'
		}
	});
};
