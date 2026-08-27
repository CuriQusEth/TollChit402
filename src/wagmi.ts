import { http, createConfig } from 'wagmi';
import { base } from 'wagmi/chains';
import { coinbaseWallet, injected } from 'wagmi/connectors';

export const config = createConfig({
  chains: [base],
  multiInjectedProviderDiscovery: false,
  connectors: [
    injected(),
    // 'all' yerine 'eoaOnly': Coinbase Smart Wallet (Base Account) bu ödemeyi
    // yapamıyor. Facilitator, EIP-3009 digest'ini doğrudan hesabın
    // isValidSignature'ına veriyor; akıllı cüzdan imzayı kendi sarmalayıcı
    // biçiminde ve replay-safe hash üzerinden beklediği için çağrı revert
    // ediyor ve ödeme invalid_exact_evm_payload_signature ile reddediliyor.
    coinbaseWallet({ appName: 'TollChit402', preference: 'eoaOnly' })
  ],
  transports: {
    [base.id]: http(),
  },
});
