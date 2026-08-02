const { x402Client, wrapFetchWithPayment } = require('@x402/fetch');
const { ExactEvmScheme } = require('@x402/evm');
const { createWalletClient, http } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { base } = require('viem/chains');

async function test() {
  const account = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http()
  });

  const signer = {
    address: account.address,
    signTypedData: async (msg) => {
      return walletClient.signTypedData(msg);
    },
    readContract: async () => true
  };

  const client = new x402Client();
  client.register("eip155:*", new ExactEvmScheme(signer));
  
  const fetchWithPayment = wrapFetchWithPayment(global.fetch, client);
  
  try {
    const res = await fetchWithPayment('http://localhost:3000/api/proxy-search?q=test');
    console.log(res.status);
    console.log(await res.text());
  } catch (e) {
    console.error(e);
  }
}
test();
