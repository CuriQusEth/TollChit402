import { http, createConfig } from 'wagmi';
import { base } from 'wagmi/chains';
import { injected, coinbaseWallet } from 'wagmi/connectors';

export const config = createConfig({
  chains: [base],
  multiInjectedProviderDiscovery: false,
  connectors: [
    injected({ target: 'metaMask' }),
    injected({ target: 'rabby' }),
    coinbaseWallet({ appName: 'x402-pay', preference: 'smartWalletOnly' })
  ],
  transports: {
    [base.id]: http(),
  },
});
