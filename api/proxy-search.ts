import type { VercelRequest, VercelResponse } from '@vercel/node';
import https from 'https';

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, PAYMENT-SIGNATURE, PAYMENT-REQUIRED, X-PAYMENT, X-402-Payment'
  );
  res.setHeader(
    'Access-Control-Expose-Headers',
    'PAYMENT-RESPONSE, PAYMENT-REQUIRED, X-PAYMENT-RESPONSE'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const target = new URL('https://x402.direct/api/search');
  const query = req.url && req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  target.search = query;

  const headers: Record<string, string> = {
    host: 'x402.direct',
    accept: 'application/json',
    'user-agent': 'x402-pay-proxy/1.0',
  };

  for (const h of [
    'payment-signature',
    'payment-required',
    'x-payment',
    'x-402-payment',
  ]) {
    const v = req.headers[h];
    if (v) headers[h] = Array.isArray(v) ? v[0] : (v as string);
  }

  if (req.headers['payment-signature'] && !headers['x-payment']) {
    headers['x-payment'] = req.headers['payment-signature'] as string;
  }

  if (headers['x-402-payment'] && !headers['x-payment']) {
    headers['x-payment'] = headers['x-402-payment'];
  }

  if (headers['x-payment']) {
    try {
      const decoded = JSON.parse(Buffer.from(headers['x-payment'], 'base64').toString('utf8'));
      if (decoded.x402Version === 2) {
        if (decoded.payload) {
          if (typeof decoded.payload.signature === 'string') {
            let sig = decoded.payload.signature;
            if (!sig.startsWith('0x')) sig = '0x' + sig;
            decoded.payload.signature = sig.toLowerCase();
          }
          if (decoded.payload.authorization) {
             if (typeof decoded.payload.authorization.from === 'string') decoded.payload.authorization.from = decoded.payload.authorization.from.toLowerCase();
             if (typeof decoded.payload.authorization.to === 'string') decoded.payload.authorization.to = decoded.payload.authorization.to.toLowerCase();
             if (typeof decoded.payload.authorization.nonce === 'string') decoded.payload.authorization.nonce = decoded.payload.authorization.nonce.toLowerCase();
          }
        }
        
        const targetNetwork = decoded.accepted?.network || 'eip155:8453';
        let v1Network = 'base';
        if (targetNetwork.includes('84532')) {
          v1Network = 'base-sepolia';
        } else if (targetNetwork.includes('8453')) {
          v1Network = 'base';
        } else {
          throw new Error(`Unsupported network: ${targetNetwork}`);
        }

        const v1Payload = {
          x402Version: 1,
          scheme: decoded.accepted?.scheme || 'exact',
          network: v1Network,
          payload: decoded.payload
        };
        headers['x-payment'] = Buffer.from(JSON.stringify(v1Payload)).toString('base64');
      }
    } catch (e: any) {
      console.error("Rewrite req failed", e);
      if (e.message.includes('Unsupported network')) {
          return res.status(400).json({ error: e.message });
      }
    }
  }

  delete headers['x-402-payment'];

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
      for (const [k, v] of Object.entries(proxyRes.headers)) {
        if (v !== undefined) {
          res.setHeader(k, v as string);
        }
      }
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader(
        'Access-Control-Expose-Headers',
        'PAYMENT-RESPONSE,PAYMENT-REQUIRED,X-PAYMENT-RESPONSE'
      );

      if (proxyRes.statusCode === 402) {
        let bodyData = Buffer.alloc(0);
        proxyRes.on('data', (chunk) => {
          bodyData = Buffer.concat([bodyData, chunk]);
        });
        proxyRes.on('end', () => {
          try {
            const bodyStr = bodyData.toString('utf8');
            let base64Body = Buffer.from(bodyStr).toString('base64');
            try {
              const parsed = JSON.parse(bodyStr);
              if (parsed.x402Version === 1) {
                const v2Payload = {
                  x402Version: 2,
                  error: parsed.error || 'Payment required',
                  resource: {
                    url: parsed.accepts?.[0]?.resource || 'https://x402.direct/api/search',
                    description: parsed.accepts?.[0]?.description || 'Search',
                    mimeType: parsed.accepts?.[0]?.mimeType || 'application/json',
                  },
                  accepts: parsed.accepts?.map((a: any) => ({
                    scheme: a.scheme,
                    network: a.network === 'base-sepolia' ? 'eip155:84532' : (a.network === 'base' ? 'eip155:8453' : a.network),
                    amount: a.maxAmountRequired || a.amount,
                    asset: a.asset,
                    payTo: a.payTo ? a.payTo.trim() : a.payTo,
                    maxTimeoutSeconds: a.maxTimeoutSeconds,
                    extra: a.extra || { name: 'USD Coin', version: '2' },
                  })),
                };
                base64Body = Buffer.from(JSON.stringify(v2Payload)).toString('base64');
              }
            } catch (jsonErr) {}
            // Send back in the header that the client expects
            res.setHeader('payment-required', base64Body);
            res.send(bodyData);
          } catch (e) {
            res.send(bodyData);
          }
        });
      } else {
        proxyRes.pipe(res);
      }
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
