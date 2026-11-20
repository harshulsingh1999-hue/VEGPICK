/**
 * FreshVeggie Delivery — Cloudflare Workers Edge Cache & Multi-Server Failover Proxy
 * Free Tier: 100,000 invocations/day per worker + Global Anycast CDN Cache (300+ PoPs)
 *
 * Configure Worker Environment Variables:
 *   PRIMARY_ORIGIN   = "https://ais-pre-mphtqhvp24i2rfhdzuywp5-8191345487.asia-southeast1.run.app"
 *   SECONDARY_ORIGIN = "https://your-backup-server.onrender.com" (optional)
 */

const CACHEABLE_GET_PATHS = new Set(['/api/catalog/bootstrap', '/api/slots']);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Handle CORS preflight cleanly at the edge
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    const isCacheableGet =
      request.method === 'GET' && CACHEABLE_GET_PATHS.has(url.pathname);

    if (isCacheableGet) {
      const cache = caches.default;
      const cachedResponse = await cache.match(request);
      if (cachedResponse) {
        const hitHeaders = new Headers(cachedResponse.headers);
        hitHeaders.set('X-Edge-Cloud', 'Cloudflare-Worker-HIT');
        hitHeaders.set('Access-Control-Allow-Origin', '*');
        return new Response(cachedResponse.body, {
          status: cachedResponse.status,
          headers: hitHeaders
        });
      }
    }

    const origins = [env.PRIMARY_ORIGIN, env.SECONDARY_ORIGIN].filter(Boolean);
    let lastResponse = null;

    for (const origin of origins) {
      try {
        const targetUrl = new URL(url.pathname + url.search, origin);
        const upstreamReq = new Request(targetUrl.toString(), {
          method: request.method,
          headers: request.headers,
          body: request.method !== 'GET' && request.method !== 'HEAD' ? request.clone().body : undefined
        });

        const upstreamRes = await fetch(upstreamReq);
        if (upstreamRes.status < 500) {
          const responseHeaders = new Headers(upstreamRes.headers);
          responseHeaders.set('Access-Control-Allow-Origin', '*');
          responseHeaders.set('X-Edge-Cloud', 'Cloudflare-Worker-MISS');

          const edgeResponse = new Response(upstreamRes.body, {
            status: upstreamRes.status,
            headers: responseHeaders
          });

          if (isCacheableGet && upstreamRes.ok) {
            ctx.waitUntil(caches.default.put(request, edgeResponse.clone()));
          }
          return edgeResponse;
        }
        lastResponse = upstreamRes;
      } catch {
        // Automatic multi-server failover to secondary origin
      }
    }

    return (
      lastResponse ||
      new Response(JSON.stringify({ error: 'All upstream origin servers unavailable.' }), {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      })
    );
  }
};
