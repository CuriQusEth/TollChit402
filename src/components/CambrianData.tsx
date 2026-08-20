import { useState } from 'react';
import { Loader2, Database, Terminal } from 'lucide-react';

export default function CambrianData() {
  const [activeTab, setActiveTab] = useState<'price' | 'block' | 'tokens' | 'evm_curators'>('price');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async (endpoint: string) => {
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const res = await fetch(`/api/data${endpoint}`, {
        headers: {
          'Accept': 'application/json'
        }
      });
      
      if (!res.ok) {
        throw new Error(`Error ${res.status}: ${res.statusText}`);
      }
      
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message || 'An error occurred while fetching data');
    } finally {
      setLoading(false);
    }
  };

  const endpoints = {
    price: '/solana/price-current?token_address=So11111111111111111111111111111111111111112',
    block: '/solana/latest-block',
    tokens: '/solana/tokens',
    evm_curators: '/evm/lending/morpho/curators'
  };

  return (
    <div className="bg-[#0a0a0a] border border-[#222] p-6 mt-12 w-full max-w-5xl mx-auto font-mono">
      <div className="flex items-center gap-3 mb-6 border-b border-[#222] pb-4">
        <Database className="text-emerald-500 w-5 h-5" />
        <h2 className="text-lg font-bold uppercase tracking-widest text-white">Cambrian Financial Intelligence</h2>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        <button 
          onClick={() => { setActiveTab('price'); fetchData(endpoints.price); }}
          className={`px-4 py-2 text-xs uppercase tracking-widest border transition-colors ${activeTab === 'price' ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-transparent border-[#333] text-gray-400 hover:border-gray-500'}`}
        >
          SOL Price
        </button>
        <button 
          onClick={() => { setActiveTab('block'); fetchData(endpoints.block); }}
          className={`px-4 py-2 text-xs uppercase tracking-widest border transition-colors ${activeTab === 'block' ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-transparent border-[#333] text-gray-400 hover:border-gray-500'}`}
        >
          Latest Block
        </button>
        <button 
          onClick={() => { setActiveTab('tokens'); fetchData(endpoints.tokens); }}
          className={`px-4 py-2 text-xs uppercase tracking-widest border transition-colors ${activeTab === 'tokens' ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-transparent border-[#333] text-gray-400 hover:border-gray-500'}`}
        >
          Token List
        </button>
        <button 
          onClick={() => { setActiveTab('evm_curators'); fetchData(endpoints.evm_curators); }}
          className={`px-4 py-2 text-xs uppercase tracking-widest border transition-colors ${activeTab === 'evm_curators' ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-transparent border-[#333] text-gray-400 hover:border-gray-500'}`}
        >
          Base Morpho
        </button>
      </div>

      <div className="bg-black border border-[#222] p-4 relative min-h-[200px]">
        <div className="absolute top-0 left-0 bg-[#222] text-gray-400 text-[10px] px-2 py-1 flex items-center gap-2">
          <Terminal className="w-3 h-3" /> response.json
        </div>
        
        <div className="pt-6 overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-emerald-500">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : error ? (
            <div className="text-red-400 text-sm">{error}</div>
          ) : data ? (
            <pre className="text-emerald-400 text-xs font-mono leading-relaxed">
              {JSON.stringify(data, null, 2)}
            </pre>
          ) : (
            <div className="text-gray-600 text-sm flex items-center justify-center h-32">
              Select an endpoint to view Cambrian data
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
