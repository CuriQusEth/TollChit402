import type { VercelRequest, VercelResponse } from '@vercel/node';
import https from 'https';
import { copyResponseHeaders } from './_proxy';

/**
 * Proxies the free (non-x402) Cambrian data endpoints used by the dashboard.
 *
 * This mirrors the `/api/data` route that server.ts serves in development.
 * Without it, `/api/data/*` fell through to the catch-all rewrite in
 * vercel.json and returned index.html, so `res.json()` in CambrianData.tsx
 * failed with "Unexpected token '<'" in production.
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const incomingUrl = new URL(req.url || '/', 'http://localhost');
  let targetPath = incomingUrl.pathname;
  if (targetPath.startsWith('/api/data')) {
    targetPath = targetPath.slice('/api/data'.length) || '/';
  }

  const headers: Record<string, string> = {
    host: 'api.cambrian.org',
    accept: 'application/json',
    'user-agent': 'x402-pay-proxy/1.0',
  };

  if (process.env.CAMBRIAN_API_KEY) {
    headers['x-api-key'] = process.env.CAMBRIAN_API_KEY;
  }

  const proxyReq = https.request(
    {
      hostname: 'api.cambrian.org',
      port: 443,
      path: targetPath + incomingUrl.search,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.status(proxyRes.statusCode || 502);
      copyResponseHeaders(proxyRes.headers, (k, v) => res.setHeader(k, v));
      res.setHeader('Access-Control-Allow-Origin', '*');

      if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
        console.error(
          `[proxy] upstream api.cambrian.org returned ${proxyRes.statusCode} for ${targetPath}${incomingUrl.search}`
        );
      }

      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (e) => {
    console.error(e);
    res.status(502).json({ error: 'proxy_failed', message: e.message });
  });

  proxyReq.end();
}
