const https = require('https');

function tryPayload(payload) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'x402.direct',
      path: '/api/search?q=test',
      method: 'GET',
      headers: {
        'x-payment': Buffer.from(JSON.stringify({
          x402Version: 1,
          scheme: 'exact',
          network: 'base',
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
      from: '0x6106AC5cD77f1B9F486550Ce90f8738BD63848B9',
      to: '0x6106AC5cD77f1B9F486550Ce90f8738BD63848B9',
      value: '1000',
      validAfter: '0',
      validBefore: '1785453227',
      nonce: '0x' + '2'.repeat(64)
    }
  };
  const res1 = await tryPayload(p1);
  console.log("P1:", res1);
}
run();
