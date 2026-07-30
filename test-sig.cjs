const { x402Client, wrapFetchWithPayment } = require('@x402/fetch');
const { ExactEvmScheme } = require('@x402/evm');

async function test() {
  const client = new x402Client();
  const signer = {
    address: '0x123',
    signTypedData: async () => '0xabcd1234',
    readContract: async () => true
  };
  client.register("eip155:*", new ExactEvmScheme(signer));
  
  const paymentRequiredJSON = {
      x402Version: 2,
      error: 'Payment required',
      resource: { url: 'http://test', description: 'test', mimeType: 'json' },
      accepts: [{
          scheme: 'exact',
          network: 'eip155:8453',
          amount: '1000',
          asset: '0x123',
          payTo: '0x123',
          maxTimeoutSeconds: 300
      }]
  };
  
  const headerValue = await client.handlePaymentRequired(Buffer.from(JSON.stringify(paymentRequiredJSON)).toString('base64'), { method: 'GET', url: 'http://test' });
  console.log("Generated Header Value:", headerValue);
  
  if (headerValue) {
      console.log("Decoded:", JSON.parse(Buffer.from(headerValue, 'base64').toString('utf8')));
  }
}

test();
