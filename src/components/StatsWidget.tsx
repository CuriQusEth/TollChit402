import { useQuery } from '@tanstack/react-query';
import { Activity, ExternalLink } from 'lucide-react';
import Card from './ui/Card';
import { useI18n } from '../i18n';

type Stats = {
  totalPayments: number;
  totalVolumeUsd: string;
  persistent: boolean;
};

async function fetchStats(): Promise<Stats> {
  const res = await fetch('/api/stats', { headers: { Accept: 'application/json' } });
  // Bu metin kullanıcıya gösterilmiyor (widget kendi mesajını basıyor); yalnızca
  // günlükte okunuyor, o yüzden çevrilmiyor.
  if (!res.ok) throw new Error(`stats request failed (${res.status})`);
  return res.json();
}

export default function StatsWidget() {
  const { t } = useI18n();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['stats'],
    queryFn: fetchStats,
    refetchInterval: 15000,
    // Sayaçlar kritik değil; bir hata tüm paneli kırmıcı olmamalı.
    retry: 1,
  });

  return (
    <div className="w-full max-w-5xl mx-auto px-6 md:px-12 mb-12">
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4 border-b border-border pb-3">
          {/* Simge nötr: başlık süsü, bir durum bildirmiyor. */}
          <Activity className="text-muted w-4 h-4" />
          <h2 className="text-body font-bold uppercase tracking-widest text-text">
            {t('stats.title')}
          </h2>
        </div>

        {isError ? (
          <p className="text-label text-dim uppercase tracking-widest">
            {t('stats.unavailable')}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-label uppercase text-dim tracking-widest mb-1">
                {t('stats.total')}
              </div>
              {/* Rakamlar emerald: doğrudan tamamlanmış ödemeleri sayıyorlar. */}
              <div className="text-display font-bold text-accent">
                {isLoading ? '—' : data?.totalPayments ?? 0}
              </div>
            </div>
            <div>
              <div className="text-label uppercase text-dim tracking-widest mb-1">
                {t('stats.volume')}
              </div>
              <div className="text-display font-bold text-accent">
                {isLoading ? '—' : `$${data?.totalVolumeUsd ?? '0.00'}`}
              </div>
            </div>
          </div>
        )}

        {data && !data.persistent && (
          // Sayaçların nereden geldiği önemli: KV yoksa rakamlar yalnızca bu
          // sürecin ömrü boyunca birikir ve yanıltıcı görünebilir.
          <p className="mt-4 text-label text-dim leading-relaxed">
            {t('stats.ephemeral')}
          </p>
        )}

        <a
          href="https://base.dev/leaderboard"
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 text-label uppercase tracking-widest text-dim hover:text-text transition-colors"
        >
          <span lang="en">{t('stats.leaderboard')}</span>
          <ExternalLink className="w-3 h-3" />
        </a>
      </Card>
    </div>
  );
}
