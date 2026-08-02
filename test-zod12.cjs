const https = require('https');

function tryPayloadV2(payload) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'x402.direct',
      path: '/api/search?q=test',
      method: 'GET',
      headers: {
        'x-402-payment': Buffer.from(JSON.stringify({
          x402Version: 2,
          accepted: {
            scheme: 'exact',
            network: 'eip155:8453',
            amount: '1000',
            asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            payTo: '0x6106AC5cD77f1B9F486550Ce90f8738BD63848B9',
            maxTimeoutSeconds: 300,
            extra: { name: 'USD Coin', version: '2' }
          },
          payload
        })).toString('base64')
      }
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.end();
  });
}

async function run() {
  const p1 = {
    signature: '0x' + '1'.repeat(130),
    authorization: {
      from: '0x6106ac5cd77f1b9f486550ce90f8738bd63848b9',
      to: '0x6106ac5cd77f1b9f486550ce90f8738bd63848b9',
      value: '1000',
      validAfter: '0',
      validBefore: '1785453227',
      nonce: '0x' + '1'.repeat(64)
    }
  };
  const res1 = await tryPayloadV2(p1);
  console.log("V2 payload to x402.direct directly:", res1);
}
run();
