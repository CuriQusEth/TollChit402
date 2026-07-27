import { WagmiProvider, useAccount } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { config } from './wagmi';
import PaymentForm from './components/PaymentForm';

const queryClient = new QueryClient();

function Header() {
  const { address } = useAccount();
  return (
    <header className="h-16 flex items-center justify-between px-8 border-b border-emerald-500/20 bg-black/40 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-emerald-500 rounded-sm flex items-center justify-center font-bold text-black text-xs italic">
          x402
        </div>
        <span className="font-black tracking-tighter text-xl italic uppercase">
          Gateway
        </span>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 bg-[#141414] px-3 py-1.5 rounded-full border border-emerald-500/30">
          <div className="w-2 h-2 bg-emerald-500 rounded-full shadow-[0_0_8px_#10b981]"></div>
          <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-emerald-400 hidden sm:block">
            Base Mainnet
          </span>
        </div>
        {address && (
          <div className="text-[11px] font-mono text-gray-500 uppercase hidden sm:block">
            {address.slice(0, 6)}...{address.slice(-4)}
          </div>
        )}
      </div>
    </header>
  );
}

export default function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <div className="bg-[#050505] text-white min-h-screen flex flex-col font-sans overflow-x-hidden border-4 border-[#141414]">
          <Header />
          <main className="flex-grow flex items-center justify-center relative py-12">
            <div className="absolute inset-0 overflow-hidden opacity-10 pointer-events-none">
              <div 
                className="absolute top-0 left-0 w-full h-full" 
                style={{ backgroundImage: 'radial-gradient(#10b981 1px, transparent 1px)', backgroundSize: '30px 30px' }}
              ></div>
            </div>
            
            <div className="z-10 grid grid-cols-1 md:grid-cols-12 gap-12 max-w-5xl w-full px-6 md:px-12">
              <div className="md:col-span-7 flex flex-col justify-center gap-2">
                <span className="text-emerald-500 font-mono text-sm tracking-[0.3em] uppercase mb-2 italic">
                  Transaction Terminal
                </span>
                <h1 className="text-[80px] md:text-[130px] font-black leading-[0.85] tracking-tighter uppercase">
                  <span className="block">Pay</span>
                  <span className="block text-transparent break-all" style={{ WebkitTextStroke: '1px #10b981' }}>
                    $0.001
                  </span>
                </h1>
                <p className="text-gray-400 text-lg mt-6 max-w-md font-light">
                  Facilitating secure micro-transactions on the <span className="text-white font-medium">Base L2</span> via the <span className="text-white font-medium italic underline decoration-emerald-500">x402 Payment Protocol</span>.
                </p>
                <div className="mt-10 flex gap-4 flex-wrap">
                  <div className="bg-[#141414] p-4 border border-emerald-900/50 flex-1 min-w-[120px]">
                    <div className="text-[10px] uppercase text-gray-500 font-bold mb-1">Network Fee</div>
                    <div className="font-mono text-emerald-400">&lt; $0.01 USDC</div>
                  </div>
                  <div className="bg-[#141414] p-4 border border-emerald-900/50 flex-1 min-w-[120px]">
                    <div className="text-[10px] uppercase text-gray-500 font-bold mb-1">Confirmations</div>
                    <div className="font-mono text-emerald-400 text-xl font-bold">~2 SEC</div>
                  </div>
                </div>
              </div>
              
              <div className="md:col-span-5 relative z-20">
                <PaymentForm />
              </div>
            </div>
          </main>
          
          <footer className="h-12 bg-black border-t border-[#141414] px-8 flex items-center justify-between text-[10px] font-mono text-gray-600 uppercase tracking-widest hidden sm:flex shrink-0">
            <div>Protocol Version: 1.0.42-STABLE</div>
            <div>&copy; 2026 x402 Development Group // Base Ecosystem</div>
            <div>Facilitator: Coinbase CDP</div>
          </footer>
        </div>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
