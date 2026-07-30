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
          <div className="flex items-center gap-2 bg-[#141414] px-3 py-1.5 rounded-full border border-emerald-500/30">
            <svg className="w-4 h-4" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M78.69 31.63L71.39 33.72C69.34 34.3 67.24 34.8 65.16 35.15L64.91 35.19C64.63 35.23 64.33 35.27 64.04 35.31C63.76 35.35 63.47 35.38 63.17 35.41L62.74 35.46C62.46 35.48 62.16 35.5 61.87 35.51L61.64 35.52C60.67 35.55 59.7 35.55 58.74 35.52H58.69C56.68 35.45 54.69 35.26 52.74 34.94C49.97 34.48 47.33 33.77 44.81 32.8C42.84 32.04 40.97 31.1 39.2 29.98C37.07 28.63 35.18 26.96 33.6 24.97C33.15 24.4 32.74 23.8 32.36 23.18C31.7 22.1 31.13 20.96 30.65 19.78C29.69 17.41 29.21 14.93 29.2 12.38V12.19V11.2C29.21 9.8 28.53 8.48 27.38 7.64C26.23 6.8 24.71 6.55 23.33 7.02C20.47 8.01 17.82 9.5 15.48 11.44C12.44 13.97 9.94 17.06 8.09 20.57C6.01 24.52 4.7 28.87 4.2 33.42C4.1 34.42 4.05 35.42 4.04 36.43V36.73V37.71C4.05 40.24 4.54 42.74 5.51 45.09C6.41 47.3 7.69 49.33 9.3 51.13C10.74 52.75 12.4 54.15 14.23 55.28C15.93 56.34 17.77 57.19 19.72 57.8C20.8 58.14 21.9 58.4 23.03 58.56C23.95 58.69 24.87 58.74 25.8 58.72H25.87H27.02C28.2 58.71 29.38 58.63 30.55 58.48C31.54 58.35 32.53 58.16 33.51 57.91C34.62 57.63 35.7 57.26 36.74 56.8C38.07 56.21 39.31 55.45 40.42 54.53C40.67 54.33 40.91 54.12 41.13 53.89C41.77 53.25 42.6 52.82 43.5 52.65C44.39 52.48 45.33 52.57 46.16 52.92C47.46 53.48 48.82 53.89 50.21 54.15C50.6 54.22 50.99 54.28 51.39 54.32C52.47 54.43 53.56 54.46 54.64 54.42C55.49 54.38 56.34 54.32 57.18 54.23C58 54.14 58.82 54.01 59.63 53.86L60.03 53.78L60.36 53.71C61.34 53.49 62.28 53.21 63.2 52.88L64.44 52.42C65.34 52.07 66.21 51.65 67.04 51.18C68.3 50.47 69.45 49.57 70.47 48.51C71.55 47.38 72.48 46.12 73.23 44.75C73.47 44.3 73.68 43.85 73.87 43.39L74.07 42.94C74.22 42.6 74.35 42.26 74.46 41.92C74.67 41.25 75.3 40.81 76.01 40.81H76.03C76.74 40.81 77.38 41.26 77.58 41.93L77.67 42.23C77.78 42.59 77.92 42.94 78.08 43.29C78.43 44.02 78.85 44.72 79.33 45.39C80.3 46.73 81.44 47.93 82.72 48.96C83.95 49.95 85.29 50.81 86.73 51.52L87.49 51.89C88.24 52.26 89.02 52.59 89.82 52.88L90.87 53.25C91.68 53.53 92.51 53.77 93.36 53.97L94.04 54.12L94.94 54.3C95.73 54.44 96.53 54.55 97.33 54.62C98.42 54.72 99.52 54.77 100.61 54.75C101.5 54.74 102.39 54.7 103.28 54.62L104.14 54.53C105.12 54.41 106.1 54.24 107.06 54C108.03 53.76 108.97 53.47 109.9 53.11C111.02 52.68 112.1 52.17 113.12 51.57C114.33 50.86 115.44 50.01 116.42 49.03C116.57 48.87 116.74 48.72 116.92 48.58C117.48 48.16 118.25 48.12 118.86 48.49C119.54 48.89 119.98 49.56 120.06 50.32V50.35V51.51C120.09 52.92 120.06 54.32 119.96 55.72C119.8 58.26 119.34 60.77 118.59 63.2C117.38 67.1 115.42 70.76 112.83 73.99C111.36 75.83 109.68 77.49 107.82 78.94C105.7 80.59 103.4 81.99 100.97 83.1C98.67 84.15 96.25 84.97 93.75 85.54C91.95 85.95 90.11 86.23 88.26 86.37C87.41 86.43 86.56 86.47 85.71 86.48H85.66H84.34H84.28C82.88 86.48 81.49 86.39 80.11 86.22H80.05C78.71 86.05 77.38 85.81 76.08 85.49L75.48 85.34C74.15 84.99 72.84 84.57 71.55 84.07C70.61 83.7 69.69 83.28 68.79 82.8C68.17 82.47 67.43 82.44 66.79 82.72C66.15 82.99 65.7 83.54 65.57 84.2C65.23 85.9 64.67 87.56 63.92 89.13L63.51 89.96L63.22 90.54C62.43 92.05 61.47 93.46 60.36 94.75C59.39 95.89 58.29 96.92 57.08 97.83C56.12 98.54 55.08 99.16 53.98 99.66C52.79 100.2 51.54 100.64 50.25 100.97L49.6 101.13L49.19 101.23C47.78 101.55 46.33 101.76 44.87 101.88C43.86 101.96 42.84 101.99 41.83 101.98H41.77H40.64H40.59C39.46 101.96 38.33 101.9 37.21 101.79L36.32 101.7C35.04 101.56 33.78 101.35 32.53 101.07C31.25 100.78 29.98 100.41 28.75 99.96C27.91 99.65 27.09 99.3 26.28 98.92C25.55 98.58 24.67 98.81 24.23 99.46L24.16 99.56C23.68 100.32 23.27 101.12 22.92 101.94C21.84 104.42 21.29 107.05 21.31 109.73V109.91V110.87C21.28 111.83 21.36 112.79 21.55 113.73C21.83 115.1 23 116.1 24.39 116.14H24.52C28.2 116.13 31.86 115.65 35.43 114.7L36.21 114.49L37.07 114.25C39.41 113.56 41.7 112.71 43.91 111.72C45.33 111.08 46.73 110.37 48.09 109.58C49.91 108.53 51.65 107.36 53.28 106.07C54.67 104.97 55.97 103.78 57.17 102.5C57.48 102.17 57.77 101.83 58.07 101.48C58.34 101.15 58.62 100.82 58.88 100.47C59.38 100.99 59.91 101.49 60.46 101.97C62.08 103.39 63.85 104.64 65.73 105.7C67.1 106.47 68.52 107.16 69.98 107.75C71.77 108.47 73.6 109.07 75.48 109.55C77.01 109.94 78.56 110.25 80.14 110.49C82.47 110.84 84.83 111.05 87.2 111.1H87.35H88.58C90.58 111.08 92.57 110.96 94.55 110.74L95.27 110.66C97.11 110.44 98.93 110.12 100.73 109.72L101.42 109.56L102.26 109.36C104.47 108.81 106.63 108.1 108.73 107.25C110.43 106.55 112.09 105.74 113.68 104.83L114.33 104.45L114.88 104.13C116.32 103.26 117.7 102.3 119 101.27C119.53 100.85 119.78 100.17 119.64 99.52C119.5 98.86 118.99 98.34 118.35 98.17L118.23 98.14C117.79 98.02 117.34 97.94 116.89 97.88L116.29 97.8C115.11 97.66 113.91 97.6 112.72 97.61H112.58H111.37H111.32C109.93 97.6 108.54 97.67 107.16 97.83L106.33 97.93C104.99 98.11 103.65 98.37 102.33 98.7L101.69 98.86C100.41 99.2 99.14 99.63 97.9 100.13C96.96 100.5 95.95 101.07 95.12 101.67C94.52 102.11 93.68 102.04 93.15 101.5C92.62 100.95 92.52 100.12 92.93 99.49C93.7 98.27 94.63 97.16 95.7 96.16C97.14 94.8 98.74 93.63 100.47 92.67C102.58 91.5 104.83 90.57 107.16 89.89C108.82 89.4 110.51 89.02 112.23 88.75C113.2 88.6 114.18 88.48 115.16 88.4L116 88.35L116.87 88.29C117.84 88.23 118.8 88.13 119.76 87.97C121.25 87.73 122.38 86.43 122.34 84.92V84.81V83.69C122.34 81.36 122.09 79.03 121.58 76.75C120.73 72.88 119.24 69.17 117.15 65.75C115.34 62.77 113.13 60.03 110.58 57.6C108.99 56.09 107.24 54.74 105.35 53.59C103.54 52.48 101.63 51.52 99.63 50.73C97.66 49.95 95.63 49.33 93.56 48.87C91.95 48.51 90.31 48.24 88.65 48.06C87.77 47.96 86.88 47.88 85.99 47.85H85.93H84.58C83.54 47.83 82.5 47.9 81.47 48.05L80.89 48.14L80.08 48.28L80.52 47.66C81.25 46.59 81.85 45.42 82.28 44.18C82.72 42.91 82.97 41.59 83.02 40.24V40.22V39.06C83.05 38.08 83 37.1 82.87 36.13C82.72 35.03 82.47 33.95 82.13 32.89L82 32.51L81.65 31.5C81.02 29.81 80.01 28.3 78.69 31.63Z" fill="url(#paint0_linear)"/>
              <defs>
                <linearGradient id="paint0_linear" x1="62.19" y1="7.02" x2="62.19" y2="116.14" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#8697FF"/>
                  <stop offset="1" stopColor="#7084FF"/>
                </linearGradient>
              </defs>
            </svg>
            <div className="text-[11px] font-mono font-bold text-gray-200 uppercase tracking-widest">
              {address.slice(0, 6)}...{address.slice(-4)}
            </div>
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
