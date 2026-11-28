/**
 * FreshVeggie Delivery — Cloudflare Workers 4-Server HA Edge Proxy & Failover Router
 * Architecture: 2 Primary Servers (Round-Robin Active-Active) + 2 Backup Servers (Instant Failover)
 * Free Tier: 100,000 invocations/day per worker + Global Anycast CDN Cache (300+ PoPs)
 *
 * Configure Worker Environment Variables:
 *   PRIMARY_ORIGIN_1 = "https://ais-pre-mphtqhvp24i2rfhdzuywp5-8191345487.asia-southeast1.run.app"
 *   PRIMARY_ORIGIN_2 = "https://your-primary-server-2.onrender.com"   (optional)
 *   BACKUP_ORIGIN_3  = "https://your-backup-server-3.fly.dev"         (optional)
 *   BACKUP_ORIGIN_4  = "https://your-backup-server-4.koyeb.app"       (optional)
 */

const CACHEABLE_GET_PATHS = new Set([
  '/api/catalog/bootstrap',
  '/api/slots',
  '/api/public/runtime-config',
  '/api/analytics/summary'
]);
let primaryPointer = 0;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

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
        hitHeaders.set('X-Server-Cluster', '2-Primary+2-Backup');
        hitHeaders.set('Access-Control-Allow-Origin', '*');
        return new Response(cachedResponse.body, {
          status: cachedResponse.status,
          headers: hitHeaders
        });
      }
    }

    const primary1 = env.PRIMARY_ORIGIN_1 || env.PRIMARY_ORIGIN || '';
    const primary2 = env.PRIMARY_ORIGIN_2 || '';
    const backup3 = env.BACKUP_ORIGIN_3 || env.SECONDARY_ORIGIN || '';
    const backup4 = env.BACKUP_ORIGIN_4 || '';

    const primaries = [
      primary1 ? { slot: 'primary-server-1', url: primary1 } : null,
      primary2 ? { slot: 'primary-server-2', url: primary2 } : null
    ].filter(Boolean);

    if (primaries.length === 2) {
      primaryPointer = (primaryPointer + 1) % 2;
      if (primaryPointer === 1) {
        primaries.reverse();
      }
    }

    const backups = [
      backup3 ? { slot: 'backup-server-3', url: backup3 } : null,
      backup4 ? { slot: 'backup-server-4', url: backup4 } : null
    ].filter(Boolean);

    const candidateOrigins = [...primaries, ...backups];
    let lastResponse = null;

    for (const origin of candidateOrigins) {
      try {
        const targetUrl = new URL(url.pathname + url.search, origin.url);
        const upstreamReq = new Request(targetUrl.toString(), {
          method: request.method,
          headers: request.headers,
          body: request.method !== 'GET' && request.method !== 'HEAD' ? request.clone().body : undefined
        });

        const upstreamRes = await fetch(upstreamReq);
        if (upstreamRes.status < 500 && upstreamRes.status !== 429) {
          const responseHeaders = new Headers(upstreamRes.headers);
          responseHeaders.set('Access-Control-Allow-Origin', '*');
          responseHeaders.set('X-Edge-Cloud', 'Cloudflare-Worker-MISS');
          responseHeaders.set('X-Served-By-Server', origin.slot);

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
        // Automatic multi-server failover to next Primary / Backup Server
      }
    }

    return (
      lastResponse ||
      new Response(JSON.stringify({ error: 'All 4 Primary and Backup origin servers are temporarily unreachable.' }), {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      })
    );
  }
};
