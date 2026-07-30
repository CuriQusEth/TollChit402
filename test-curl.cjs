const https = require('https');

const req = https.request({
  hostname: 'x402.direct',
  path: '/api/search?q=test',
  method: 'GET',
  headers: {
    'x-payment': Buffer.from(JSON.stringify({
      x402Version: 1,
      scheme: 'exact',
      network: 'base',
      payload: {
        authorization: { from: '0x0', to: '0x0', value: '0', validAfter: '0', validBefore: '0', nonce: '0x0' },
        signature: '0x123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678'
      }
    })).toString('base64')
  }
}, (res) => {
  console.log(res.statusCode);
  res.on('data', d => process.stdout.write(d));
});
req.end();
