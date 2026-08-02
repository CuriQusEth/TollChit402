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
    signature: '0x0051c45032a6b1e5c7e1b10d75c365cdee13a2ebddb7d5f100afcf361fba015f1e39eb6e6fd7b862329394f6291ca09e046e31e27b9b7b0b868683b59ea49b851c', // 132 chars (65 bytes EIP-712 signature)
    authorization: {
      from: '0x6106AC5cD77f1B9F486550Ce90f8738BD63848B9'.toLowerCase(),
      to: '0x6106AC5cD77f1B9F486550Ce90f8738BD63848B9'.toLowerCase(),
      value: '1000',
      validAfter: '0',
      validBefore: '1785453227',
      nonce: '0x' + '2'.repeat(64)
    }
  };
  const res1 = await tryPayload(p1);
  console.log("P1 with 132 char sig:", res1);
}
run();
