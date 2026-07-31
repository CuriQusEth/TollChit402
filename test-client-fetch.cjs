const { x402Client, wrapFetchWithPayment } = require('@x402/fetch');
const { ExactEvmScheme } = require('@x402/evm');
const https = require('https');

async function test() {
  const client = new x402Client();
  const signer = {
    address: '0x6106AC5cD77f1B9F486550Ce90f8738BD63848B9',
    signTypedData: async () => '0x' + '1'.repeat(130), // 130 chars of hex + 0x = 132 chars
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

  const payload = await client.createPaymentPayload(paymentRequiredJSON, { method: 'GET', url: 'https://x402.direct/api/search?q=test' });
  console.log("PAYLOAD:", payload);
}
test();
