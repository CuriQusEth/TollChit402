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
    signature: '0x' + '1'.repeat(130), // 132 chars (65 bytes EIP-712 signature)
    authorization: {
      from: '0x6106ac5cd77f1b9f486550ce90f8738bd63848b9',
      to: '0x6106ac5cd77f1b9f486550ce90f8738bd63848b9',
      value: '1000',
      validAfter: '0',
      validBefore: '1785453227',
      nonce: '0x' + '1'.repeat(64)
    }
  };
  const res1 = await tryPayload(p1);
  console.log("P1 with 132 char sig:", res1);
}
run();
