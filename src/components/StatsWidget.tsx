import { useQuery } from '@tanstack/react-query';
import { Activity, ExternalLink } from 'lucide-react';

type Stats = {
  totalPayments: number;
  totalVolumeUsd: string;
  persistent: boolean;
};

async function fetchStats(): Promise<Stats> {
  const res = await fetch('/api/stats', { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`İstatistikler alınamadı (${res.status})`);
  return res.json();
}

export default function StatsWidget() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['stats'],
    queryFn: fetchStats,
    refetchInterval: 15000,
    // Sayaçlar kritik değil; bir hata tüm paneli kırmıcı olmamalı.
    retry: 1,
  });

  return (
    <div className="w-full max-w-5xl mx-auto px-6 md:px-12 mb-12">
      <div className="bg-[#0a0a0a] border border-[#222] p-5 font-mono">
        <div className="flex items-center gap-2 mb-4 border-b border-[#222] pb-3">
          <Activity className="text-emerald-500 w-4 h-4" />
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-white">
            Ödeme İstatistikleri
          </h2>
        </div>

        {isError ? (
          <p className="text-[10px] text-gray-600 uppercase tracking-widest">
            İstatistikler şu anda okunamıyor.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-[9px] uppercase text-gray-500 tracking-widest mb-1">
                Toplam Ödeme
              </div>
              <div className="text-2xl font-bold text-emerald-400">
                {isLoading ? '—' : data?.totalPayments ?? 0}
              </div>
            </div>
            <div>
              <div className="text-[9px] uppercase text-gray-500 tracking-widest mb-1">
                Toplam Hacim
              </div>
              <div className="text-2xl font-bold text-emerald-400">
                {isLoading ? '—' : `$${data?.totalVolumeUsd ?? '0.00'}`}
              </div>
            </div>
          </div>
        )}

        {data && !data.persistent && (
          // Sayaçların nereden geldiği önemli: KV yoksa rakamlar yalnızca bu
          // sürecin ömrü boyunca birikir ve yanıltıcı görünebilir.
          <p className="mt-4 text-[9px] text-gray-600 leading-relaxed">
            Kalıcı depolama (Vercel KV) yapılandırılmamış — sayaçlar bellekte
            tutuluyor ve her yeniden başlatmada sıfırlanıyor.
          </p>
        )}

        <a
          href="https://base.dev/leaderboard"
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-gray-500 hover:text-emerald-400 transition-colors"
        >
          Builder Code sıralaması
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
}
