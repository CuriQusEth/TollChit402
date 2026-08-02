import type { VercelRequest, VercelResponse } from '@vercel/node';
import https from 'https';

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, PAYMENT-SIGNATURE, PAYMENT-REQUIRED, X-PAYMENT'
  );
  res.setHeader(
    'Access-Control-Expose-Headers',
    'PAYMENT-RESPONSE, PAYMENT-REQUIRED, X-PAYMENT-RESPONSE'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Forward the real incoming query string instead of a hardcoded one.
  const incomingUrl = new URL(req.url || '', 'http://localhost');
  const target = new URL('https://x402.direct/api/search');
  target.search = incomingUrl.search;

  const headers: Record<string, string> = {
    host: 'x402.direct',
    accept: 'application/json',
    'user-agent': 'x402-pay-proxy/1.0',
  };

  // Forward the payment header as-is. The x402 client SDK on the frontend
  // already produces a protocol-v1-correct X-PAYMENT value for x402.direct
  // (via client.registerV1 + ExactEvmSchemeV1), so no rewriting is needed.
  const v = req.headers['x-payment'];
  if (v) headers['x-payment'] = Array.isArray(v) ? v[0] : (v as string);

  const proxyReq = https.request(
    {
      hostname: 'x402.direct',
      port: 443,
      path: target.pathname + target.search,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.status(proxyRes.statusCode || 500);
      for (const [k, val] of Object.entries(proxyRes.headers)) {
        if (val !== undefined) {
          res.setHeader(k, val as string);
        }
      }

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader(
        'Access-Control-Expose-Headers',
        'PAYMENT-RESPONSE, PAYMENT-REQUIRED, X-PAYMENT-RESPONSE'
      );

      if (proxyRes.statusCode && proxyRes.statusCode >= 400 && proxyRes.statusCode !== 402) {
        console.error(
          `[proxy] upstream x402.direct returned ${proxyRes.statusCode} for ${target.pathname}${target.search}`
        );
      }

      // Body is forwarded untouched — the SDK already knows how to read a
      // v1-style JSON 402 body directly (getPaymentRequiredResponse falls
      // back to the body when there's no PAYMENT-REQUIRED header).
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
