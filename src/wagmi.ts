import { http, createConfig } from 'wagmi';
import { base } from 'wagmi/chains';
import { coinbaseWallet, metaMask } from 'wagmi/connectors';

export const config = createConfig({
  chains: [base],
  multiInjectedProviderDiscovery: false,
  connectors: [
    metaMask(),
    coinbaseWallet({ appName: 'x402-pay', preference: 'all' })
  ],
  transports: {
    [base.id]: http(),
  },
});
