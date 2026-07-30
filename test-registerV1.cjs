const { x402Client } = require('@x402/fetch');
const { ExactEvmScheme } = require('@x402/evm');

const client = new x402Client();
const signer = {
  address: '0x6106AC5cD77f1B9F486550Ce90f8738BD63848B9',
  signTypedData: async () => '0x000000',
  readContract: async () => true
};
client.register("eip155:*", new ExactEvmScheme(signer));
console.log(typeof client.registerV1);
