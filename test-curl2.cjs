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
        authorization: { 
          from: '0x6106AC5cD77f1B9F486550Ce90f8738BD63848B9', 
          to: '0x6106AC5cD77f1B9F486550Ce90f8738BD63848B9', 
          value: '1000', 
          validAfter: '0', 
          validBefore: '1785453286', 
          nonce: '0x1c5ecb57ac243ff64616efac4553e174901cf5d443b4b50ff92f57272674e66a' 
        },
        signature: '0xabcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234ab' // 65 bytes = 130 hex chars + 0x = 132 chars
      }
    })).toString('base64')
  }
}, (res) => {
  console.log(res.statusCode);
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => console.log(body));
});
req.end();
