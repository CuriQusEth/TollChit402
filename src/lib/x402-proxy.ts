export function transformX402PaymentHeader(paymentHeader: string): string | null {
  try {
    const decoded = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf8'));
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
      return Buffer.from(JSON.stringify(v1Payload)).toString('base64');
    }
  } catch (e: any) {
    if (e.message.includes('Unsupported network')) {
      throw e;
    }
    console.error("Rewrite req failed", e);
  }
  return null;
}

export function transformPaymentRequiredResponse(bodyStr: string): string | null {
  try {
    const parsed = JSON.parse(bodyStr);
    if (parsed.x402Version === 1) {
      const v2Payload = {
        x402Version: 2,
        error: parsed.error || "Payment required",
        resource: {
           url: parsed.accepts?.[0]?.resource || "https://x402.direct/api/search",
           description: parsed.accepts?.[0]?.description || "Search",
           mimeType: parsed.accepts?.[0]?.mimeType || "application/json"
        },
        accepts: parsed.accepts?.map((a: any) => ({
           scheme: a.scheme,
           network: a.network === "base-sepolia" ? "eip155:84532" : (a.network === "base" ? "eip155:8453" : a.network),
           amount: a.maxAmountRequired || a.amount,
           asset: a.asset,
           payTo: a.payTo ? a.payTo.trim() : a.payTo,
           maxTimeoutSeconds: a.maxTimeoutSeconds,
           extra: a.extra || { name: 'USD Coin', version: '2' },
        })),
        extensions: {
          "builder-code": {
            info: { a: "cdp_proxy" },
            schema: {
              "$schema": "https://json-schema.org/draft/2020-12/schema",
              type: "object",
              properties: {
                a: { type: "string", pattern: "^[a-z0-9_]{1,32}$" },
                w: { type: "string", pattern: "^[a-z0-9_]{1,32}$" },
                s: { type: "string", pattern: "^[a-z0-9_]{1,32}$" }
              },
              additionalProperties: false
            }
          }
        }
      };
      return Buffer.from(JSON.stringify(v2Payload)).toString('base64');
    }
  } catch (jsonErr) {}
  return null;
}
