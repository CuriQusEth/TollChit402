import type { VercelRequest, VercelResponse } from '@vercel/node';
import https from 'https';
import { copyResponseHeaders } from './_proxy';

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, PAYMENT-SIGNATURE, PAYMENT-REQUIRED, X-PAYMENT, x-api-key'
  );
  res.setHeader(
    'Access-Control-Expose-Headers',
    'PAYMENT-RESPONSE, PAYMENT-REQUIRED, X-PAYMENT-RESPONSE'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const incomingUrl = new URL(req.url || '/', 'http://localhost');
  let targetPath = incomingUrl.pathname;
  if (targetPath.startsWith('/api/cambrian')) {
    targetPath = targetPath.replace('/api/cambrian', '') || '/';
  }
  
  const target = new URL(`https://x402.cambrian.org${targetPath}`);
  target.search = incomingUrl.search;

  const headers: Record<string, string> = {
    host: 'x402.cambrian.org',
    accept: 'application/json',
    'user-agent': 'x402-pay-proxy/1.0',
  };

  for (const [key, value] of Object.entries(req.headers)) {
    if (key.toLowerCase().startsWith('payment-') || key.toLowerCase().startsWith('x-payment')) {
      headers[key.toLowerCase()] = Array.isArray(value) ? value[0] : (value as string);
    }
  }
  
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  
  if (process.env.CAMBRIAN_API_KEY) {
    headers['x-api-key'] = process.env.CAMBRIAN_API_KEY;
  }

  const proxyReq = https.request(
    {
      hostname: 'x402.cambrian.org',
      port: 443,
      path: target.pathname + target.search,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.status(proxyRes.statusCode || 502);
      copyResponseHeaders(proxyRes.headers, (k, v) => res.setHeader(k, v));

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader(
        'Access-Control-Expose-Headers',
        'PAYMENT-RESPONSE, PAYMENT-REQUIRED, X-PAYMENT-RESPONSE'
      );

      if (proxyRes.statusCode && proxyRes.statusCode >= 400 && proxyRes.statusCode !== 402) {
        console.error(
          `[proxy] upstream x402.cambrian.org returned ${proxyRes.statusCode} for ${target.pathname}${target.search}`
        );
      }

      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (e) => {
    console.error(e);
    res.status(502).json({ error: 'proxy_failed', message: e.message });
  });

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (req.body) {
      proxyReq.write(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
    }
    proxyReq.end();
  } else {
    proxyReq.end();
  }
}
