import { WagmiProvider, useAccount } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Languages, Wallet } from 'lucide-react';
import { LanguageProvider, useI18n } from './i18n';
import { config } from './wagmi';
import Logo from './components/Logo';
import PaymentForm from './components/PaymentForm';
import StatsWidget from './components/StatsWidget';
import GmWidget from './components/GmWidget';

const queryClient = new QueryClient();

/** TR ⇄ EN düğmesi. Etiket, geçilecek dili gösteriyor. */
function LanguageToggle() {
  const { lang, setLang, t } = useI18n();
  return (
    <button
      type="button"
      onClick={() => setLang(lang === 'en' ? 'tr' : 'en')}
      title={t('lang.switch')}
      aria-label={t('lang.switch')}
      className="flex items-center gap-1.5 bg-surface-2 px-3 py-1.5 rounded-full border border-border-strong text-label font-bold uppercase tracking-widest text-muted hover:text-text hover:border-border-strong transition-colors"
    >
      <Languages className="w-3.5 h-3.5" />
      {/* Etiket iki harfli bir dil kodu; Türkçe büyük harf kuralına takılmasın
          diye lang="en" ile işaretli. */}
      <span lang="en">{t('lang.short')}</span>
    </button>
  );
}

function Header() {
  const { address } = useAccount();
  return (
    <header className="h-16 flex items-center justify-between px-8 border-b border-border bg-surface/60 backdrop-blur-md">
      <Logo />
      <div className="flex items-center gap-3">
        <LanguageToggle />
        <div className="flex items-center gap-2 bg-surface-2 px-3 py-1.5 rounded-full border border-border-strong">
          {/* Nokta emerald: ağ bağlı ve etkin — gerçek bir durum. */}
          <div className="w-2 h-2 bg-accent rounded-full shadow-[0_0_8px_var(--color-accent-glow)]"></div>
          <span
            lang="en"
            className="text-label font-bold uppercase tracking-widest text-accent hidden sm:block"
          >
            Base Mainnet
          </span>
        </div>
        {address && (
          <div className="flex items-center gap-2 bg-surface-2 px-3 py-1.5 rounded-full border border-border-strong">
            {/* Coinbase'in mor marka glifi kaldırıldı (#8697FF/#7084FF): yeni
                logoya ait olmayan bir renkti ve cüzdan MetaMask de olabiliyor.
                Yerine nötr bir cüzdan simgesi — bağlı hesabı tanıtıyor, bir
                başarı durumu bildirmiyor, o yüzden emerald değil muted. */}
            <Wallet className="w-3.5 h-3.5 text-muted" />
            <div className="text-body font-bold text-text uppercase tracking-widest">
              {address.slice(0, 6)}...{address.slice(-4)}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

function Shell() {
  const { t, tNode } = useI18n();
  return (
    <div className="bg-bg text-text min-h-screen flex flex-col font-mono overflow-x-hidden border-4 border-surface-2">
      <Header />
      <main className="flex-grow flex flex-col items-center justify-center relative py-12">
        <div className="absolute inset-0 overflow-hidden opacity-10 pointer-events-none">
          <div
            className="absolute top-0 left-0 w-full h-full"
            style={{
              backgroundImage:
                'radial-gradient(var(--color-accent) 1px, transparent 1px)',
              backgroundSize: '30px 30px',
            }}
          ></div>
        </div>
      
        <div className="z-10 grid grid-cols-1 md:grid-cols-12 gap-12 max-w-5xl w-full px-6 md:px-12">
          <div className="md:col-span-7 flex flex-col justify-center gap-2">
            <span className="text-muted text-label tracking-[0.3em] uppercase mb-2">
              {t('hero.terminal')}
            </span>
            <h1 className="text-hero font-black leading-[0.85] tracking-tighter uppercase">
              <span className="block">{t('hero.pay')}</span>
              {/* Kontur emerald değil: bu bir fiyat, bir durum değil.
                  Emerald "ödendi" anlamını koruyabilsin diye nötr. */}
              <span
                className="block text-transparent break-all"
                style={{ WebkitTextStroke: '1px var(--color-muted)' }}
              >
                $0.001
              </span>
            </h1>
            <p className="text-muted text-subhead mt-6 max-w-md leading-relaxed">
              {tNode('hero.blurb', {
                base: <span lang="en" className="text-text">{t('hero.base')}</span>,
                protocol: (
                  <span className="text-text underline decoration-border-strong underline-offset-4">
                    {t('hero.protocol')}
                  </span>
                ),
              })}
            </p>
            <div className="mt-10 flex gap-4 flex-wrap">
              {/* Bunlar bilgi kutuları, durum göstergesi değil — emerald yok. */}
              <div className="bg-surface-2 p-4 border border-border rounded-sm flex-1 min-w-[120px]">
                <div className="text-label uppercase text-dim font-bold mb-1">{t('stat.networkFee')}</div>
                <div lang="en" className="text-body text-text">&lt; $0.01 USDC</div>
              </div>
              <div className="bg-surface-2 p-4 border border-border rounded-sm flex-1 min-w-[120px]">
                <div className="text-label uppercase text-dim font-bold mb-1">{t('stat.confirmations')}</div>
                <div className="text-display text-text font-bold">{t('stat.confirmationsValue')}</div>
              </div>
            </div>
          </div>
        
          <div className="md:col-span-5 relative z-20">
            <PaymentForm />
          </div>
        </div>
      </main>

      <StatsWidget />

      {/* Ücretli uçtan sonra ücretsiz olan: gm kartı istatistiklerin hemen
          altında, aynı genişlikte. */}
      <div className="w-full max-w-5xl mx-auto px-6 md:px-12 mb-12">
        <GmWidget />
      </div>

      <footer className="h-12 bg-bg border-t border-border px-8 flex items-center justify-between text-label text-dim uppercase tracking-widest hidden sm:flex shrink-0">
        <div>{t('footer.protocol')}</div>
        <div>
          {tNode('footer.copyright', {
            brand: <span lang="en">TollChit402</span>,
          })}
        </div>
        <div lang="en">{t('footer.facilitator')}</div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          <Shell />
        </LanguageProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
