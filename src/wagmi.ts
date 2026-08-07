import { http, createConfig } from 'wagmi';
import { base } from 'wagmi/chains';
import { coinbaseWallet, injected, metaMask } from 'wagmi/connectors';

export const config = createConfig({
  chains: [base],
  multiInjectedProviderDiscovery: false,
  connectors: [
    metaMask(),
    coinbaseWallet({ appName: 'x402-pay', preference: 'all' }),
    injected({ target: 'rabby' })
  ],
  transports: {
    [base.id]: http(),
  },
});
