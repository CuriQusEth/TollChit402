const https = require('https');

function tryPayload(path, payload) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'x402.direct',
      path: path,
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
    signature: '0x' + '1'.repeat(130), // Invalid sig but we just want to see if it's 404 or 500
    authorization: {
      from: '0x6106ac5cd77f1b9f486550ce90f8738bd63848b9',
      to: '0x6106ac5cd77f1b9f486550ce90f8738bd63848b9',
      value: '1000',
      validAfter: '0',
      validBefore: '1785453227',
      nonce: '0x' + '1'.repeat(64)
    }
  };
  const res1 = await tryPayload('/api/search', p1);
  console.log("No query:", res1);
  const res2 = await tryPayload('/api/search?q=test', p1);
  console.log("With query:", res2);
}
run();
