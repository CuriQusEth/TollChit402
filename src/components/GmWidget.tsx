import { useCallback, useEffect, useState } from 'react';
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from 'wagmi';
import { Loader2, Sunrise, Flame } from 'lucide-react';
import Card from './ui/Card';
import Button from './ui/Button';
import { GM_ABI, GM_CONTRACT } from '../lib/gm';
import { useI18n, type MessageKey } from '../i18n';

const BASE_CHAIN_ID = 8453;

/**
 * Zincirden gelen hatayı okunabilir bir cümleye çevirir.
 *
 * DİKKAT: viem, çözülmüş özel hatanın adını (`AlreadySaidGmToday` gibi)
 * `shortMessage`'a KOYMUYOR — orada yalnızca "The contract function "gm"
 * reverted." gibi jenerik bir cümle duruyor, ad ise `metaMessages` içinde.
 * Bu yüzden sınıflandırma bütün alanlara bakıyor. (Aynı tuzağa
 * api/_receipt.ts'te de düşülmüştü.)
 */
function describeGmError(
  err: unknown,
  t: (key: MessageKey) => string
): { text: string; tone: 'info' | 'error' } {
  const source = err as {
    shortMessage?: string;
    message?: string;
    metaMessages?: string[];
    details?: string;
  } | null;

  const clean = (text: string) => text.replace(/\s+/g, ' ').trim();
  const summary = clean(source?.shortMessage || source?.message || String(err));
  const haystack = clean(
    [summary, ...(source?.metaMessages ?? []), source?.details ?? ''].join(' ')
  );

  // Bu ikisi arıza değil, normal durum: bugün zaten gm denmiş ya da kullanıcı
  // işlemi kendi reddetmiş. Kırmızı göstermek yanıltıcı olurdu.
  if (/AlreadySaidGmToday/i.test(haystack)) {
    return { text: t('gm.already'), tone: 'info' };
  }
  if (/user rejected|user denied|4001/i.test(haystack)) {
    return { text: t('gm.rejected'), tone: 'info' };
  }

  // Sınıflandırılamadı. Kontratın kendi cümlesi varsa onu da göster: jenerik
  // "reverted" tek başına hiçbir şey anlatmıyor.
  const detail = clean(source?.details ?? '');
  const full =
    detail && !summary.toLowerCase().includes(detail.toLowerCase())
      ? `${summary} — ${detail}`
      : summary;
  return { text: full || t('err.unknown'), tone: 'error' };
}

/** Zincirden okunan durum. Okuma başarısızsa null kalır ve kart gizlenir. */
type GmState = {
  total: bigint;
  streak: bigint;
  saidToday: boolean;
};

type Phase = 'idle' | 'sending' | 'error';

/**
 * "Günaydın Base" kartı.
 *
 * Ödeme akışının tam tersi bir uç: ücretsiz, herkese açık, kimlik doğrulaması
 * yok. Günde bir kez `gm()` çağrılır; ardışık günler seriyi büyütür.
 *
 * DİKKAT — GAZI KULLANICI ÖDER. Sayfadaki x402 ödemesi alıcı için gazsızdır
 * (yalnızca imza atılır, gazı facilitator öder). Buradaki `gm()` ise cüzdandan
 * gönderilen sıradan bir işlem: kullanıcı kendi gazını öder. Kart bunu açıkça
 * yazıyor, yoksa iki akış birbirine karışır.
 *
 * Kontrat zincirden doğrulanamadığı durumlarda (yanlış adres, ABI uyuşmazlığı,
 * RPC arızası) okuma düşer ve kart hiç görünmez — bozuk bir kart göstermek
 * yerine sessizce yok olmayı yeğliyor, çünkü bu özellik ödeme akışının yanında
 * ikincil.
 */
export default function GmWidget() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { switchChainAsync } = useSwitchChain();
  const { t } = useI18n();

  const [state, setState] = useState<GmState | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!publicClient) return;
    try {
      const total = (await publicClient.readContract({
        address: GM_CONTRACT,
        abi: GM_ABI,
        functionName: 'totalGMs',
        // `authorizationList: undefined` yalnızca tip düzeyinde gerekiyor:
        // tsconfig'de strictNullChecks kapalı olduğu için viem'in koşullu tipi
        // bu isteğe bağlı alanı zorunlu sayıyor (api/_receipt.ts'te de aynısı).
        authorizationList: undefined,
      })) as bigint;

      // Cüzdan bağlı değilse kişisel alanlar okunamaz; sayaç yine gösterilir.
      let streak = 0n;
      let saidToday = false;
      if (address) {
        [streak, saidToday] = (await Promise.all([
          publicClient.readContract({
            address: GM_CONTRACT,
            abi: GM_ABI,
            functionName: 'currentStreak',
            args: [address],
            authorizationList: undefined,
          }),
          publicClient.readContract({
            address: GM_CONTRACT,
            abi: GM_ABI,
            functionName: 'hasSaidGmToday',
            args: [address],
            authorizationList: undefined,
          }),
        ])) as [bigint, boolean];
      }

      setState({ total, streak, saidToday });
    } catch (err) {
      // İlk okuma düşerse kart hiç görünmez: adres yanlış, ABI uyuşmuyor ya da
      // RPC kapalı olabilir. Ama bir kez okunduktan SONRA gelen geçici bir
      // arıza kartı yok etmemeli — kullanıcı düğmeye bastığı anda panelin
      // gözden kaybolması, olan biten hakkında hiçbir şey söylemez.
      console.warn('[gm] Kontrat okunamadı:', err);
      // Durum bilerek DOKUNULMADAN bırakılıyor: ilk okuma düştüyse zaten null
      // ve kart görünmüyor; sonraki bir arıza ise ekranda duranı korur.
    }
  }, [publicClient, address]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sayGm = async () => {
    if (!walletClient || !publicClient) return;

    setPhase('sending');
    setMessage(null);

    try {
      if (walletClient.chain?.id !== BASE_CHAIN_ID) {
        await switchChainAsync({ chainId: BASE_CHAIN_ID });
      }

      // Göndermeden önce simüle: aynı gün ikinci çağrı burada yakalanır ve
      // kullanıcı boş yere gaz ödemez.
      await publicClient.simulateContract({
        address: GM_CONTRACT,
        abi: GM_ABI,
        functionName: 'gm',
        account: walletClient.account,
        authorizationList: undefined,
      });

      const hash = await walletClient.writeContract({
        address: GM_CONTRACT,
        abi: GM_ABI,
        functionName: 'gm',
        account: walletClient.account,
        chain: walletClient.chain,
        // Sıradan bir EIP-1559 işlemi; `kzg: undefined` da yalnızca tip
        // düzeyinde gerekiyor (yukarıdaki notla aynı sebep).
        type: 'eip1559',
        kzg: undefined,
      });

      await publicClient.waitForTransactionReceipt({ hash });
      setPhase('idle');
      setMessage(t('gm.done'));
      await refresh();
    } catch (err) {
      // Tam hata konsolda kalsın: sınıflandırma tutmazsa teşhis oradan sürer.
      console.warn('[gm] gm() başarısız:', err);
      const described = describeGmError(err, t);
      setPhase(described.tone === 'error' ? 'error' : 'idle');
      setMessage(described.text);

      // Durumu zincirden tazele. Kullanıcı sayfayı açtıktan SONRA başka bir
      // yerden (Remix, Basescan, ikinci sekme) gm demişse buradaki okuma
      // eskimiş olur ve düğme yanlışlıkla açık kalır; tazeleme onu kapatır.
      await refresh();
    }
  };

  // Kontrat okunamıyorsa özellik yokmuş gibi davran.
  if (!state) return null;

  const busy = phase === 'sending';
  const done = state.saidToday;

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-4 border-b border-border pb-3">
        {/* Simge nötr: başlık süsü, bir durum bildirmiyor. */}
        <Sunrise className="text-muted w-4 h-4" />
        <h2 className="text-body font-bold uppercase tracking-widest text-text">
          {t('gm.title')}
        </h2>
      </div>

      <p className="text-label text-dim leading-relaxed mb-4">{t('gm.blurb')}</p>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <div className="text-label uppercase text-dim tracking-widest mb-1">
            {t('gm.total')}
          </div>
          {/* Rakamlar emerald: zincirde gerçekleşmiş çağrıları sayıyorlar. */}
          <div className="text-display font-bold text-accent">
            {state.total.toString()}
          </div>
        </div>
        <div>
          <div className="text-label uppercase text-dim tracking-widest mb-1">
            {t('gm.streak')}
          </div>
          <div className="text-display font-bold text-accent flex items-center gap-1.5">
            {isConnected ? (
              <>
                {state.streak > 0n && <Flame className="w-4 h-4" />}
                {state.streak.toString()}
              </>
            ) : (
              '—'
            )}
          </div>
        </div>
      </div>

      <Button
        variant="secondary"
        onClick={sayGm}
        disabled={busy || !isConnected || done}
        className="w-full justify-center"
      >
        {busy ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {t('gm.sending')}
          </>
        ) : done ? (
          t('gm.already')
        ) : !isConnected ? (
          t('gm.connect')
        ) : (
          t('gm.say')
        )}
      </Button>

      {message && (
        <p
          className={`mt-3 text-label leading-relaxed ${
            phase === 'error' ? 'text-danger' : 'text-muted'
          }`}
        >
          {message}
        </p>
      )}

      <p className="mt-3 text-label text-dim leading-relaxed">{t('gm.gasNote')}</p>

      <a
        href={`https://basescan.org/address/${GM_CONTRACT}`}
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-flex text-label uppercase tracking-widest text-dim hover:text-text transition-colors"
      >
        {t('gm.contract')}
      </a>
    </Card>
  );
}
