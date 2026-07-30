const { x402Client } = require('@x402/fetch');
const { ExactEvmScheme } = require('@x402/evm');
const https = require('https');

async function test() {
  const client = new x402Client();
  const signer = {
    address: '0x6106AC5cD77f1B9F486550Ce90f8738BD63848B9',
    signTypedData: async () => '0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000012',
    readContract: async () => true
  };
  client.register("eip155:*", new ExactEvmScheme(signer));
  
  const paymentRequiredJSON = {
      x402Version: 2,
      error: 'Payment required',
      resource: { url: 'https://x402.direct/api/search?q=test', description: 'test', mimeType: 'json' },
      accepts: [{
          scheme: 'exact',
          network: 'eip155:8453',
          amount: '1000',
          asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          payTo: '0x6106AC5cD77f1B9F486550Ce90f8738BD63848B9',
          maxTimeoutSeconds: 300,
          extra: { name: 'USD Coin', version: '2' }
      }]
  };
  
  const v2Header = await client.createPaymentPayload(paymentRequiredJSON, { method: 'GET', url: 'https://x402.direct/api/search?q=test' });
  
  const v1Payload = {
    x402Version: 1,
    scheme: v2Header.accepted?.scheme || 'exact',
    network: v2Header.accepted?.network?.includes('8453') ? 'base' : 'base',
    payload: v2Header.payload
  };
  
  const req = https.request({
    hostname: 'x402.direct',
    path: '/api/search?q=test',
    method: 'GET',
    headers: {
      'x-payment': Buffer.from(JSON.stringify(v1Payload)).toString('base64')
    }
  }, (res) => {
    console.log(res.statusCode);
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => console.log(body));
  });
  req.end();
}
test();
