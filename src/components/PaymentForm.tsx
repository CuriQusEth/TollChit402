import { useCallback, useEffect, useState } from 'react';
import { useAccount, useConnect, useDisconnect, useWalletClient, usePublicClient, useSwitchChain } from 'wagmi';
import { Loader2, CheckCircle2, AlertCircle, LogOut } from 'lucide-react';
import { x402Client, wrapFetchWithPayment, decodePaymentResponseHeader } from '@x402/fetch';
import type { ClientEvmSigner } from '@x402/evm';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { UptoEvmScheme } from '@x402/evm/upto/client';
import { ExactEvmSchemeV1 } from '@x402/evm/v1';
import ToastStack, { type ToastMessage, type ToastKind } from './Toast';
import { TIERS, type TierId } from '../../shared/tiers';
import {
  appendRecord,
  clearHistory,
  loadHistory,
  relativeTime,
  shortAddress,
  type PaymentRecord,
} from '../lib/paymentHistory';

const BASE_CHAIN_ID = 8453;
const PRICE_LABEL = '$0.05';
const NETWORK = 'eip155:8453';

/** Ödemenin hangi aşamada olduğunu kullanıcıya göstermek için. */
type PaymentStep = 'idle' | 'signing' | 'verifying' | 'settling' | 'done' | 'error';

const STEP_LABELS: Record<Exclude<PaymentStep, 'idle'>, string> = {
  signing: 'Cüzdanda imzalanıyor',
  verifying: 'Ödeme doğrulanıyor',
  settling: 'Zincire yazılıyor',
  done: 'Tamamlandı',
  error: 'Başarısız',
};

const STEP_ORDER: PaymentStep[] = ['signing', 'verifying', 'settling', 'done'];

/**
 * Some wallets return the EIP-712 recovery byte (`v`) as 0x00/0x01 rather than
 * the 0x1b/0x1c that ecrecover expects, which makes the facilitator reject an
 * otherwise valid signature. Signatures of any other shape (notably ERC-1271 /
 * ERC-6492 blobs from smart-contract accounts) are passed through untouched.
 */
function normalizeRecoveryByte(signature: `0x${string}`): `0x${string}` {
  if (signature.length !== 132) return signature;
  const v = signature.slice(-2).toLowerCase();
  if (v === "00") return `${signature.slice(0, -2)}1b` as `0x${string}`;
  if (v === "01") return `${signature.slice(0, -2)}1c` as `0x${string}`;
  return signature;
}

/**
 * Ham hatayı kullanıcının bir şey yapabileceği bir mesaja çevirir.
 *
 * En çok karışan iki durum ayrılıyor: kullanıcının imzayı reddetmesi bir arıza
 * değildir, yetersiz bakiye ise cüzdana para koymayı gerektirir. Cüzdanlar reddi
 * EIP-1193'ün 4001 koduyla bildirir; kod taşımayanlar için metne bakılır.
 */
function describePaymentError(err: unknown): string {
  const error = err as { code?: number; message?: string; cause?: { code?: number } };
  const code = error?.code ?? error?.cause?.code;
  const raw = error?.message ?? '';

  if (code === 4001 || /user rejected|user denied|rejected the request/i.test(raw)) {
    return 'İşlemi cüzdanınızda reddettiniz. Ödeme yapılmadı.';
  }

  if (/insufficient (funds|balance)|transfer amount exceeds balance/i.test(raw)) {
    return 'Yetersiz bakiye. Base ağında en az 0.05 USDC bulundurmanız gerekiyor.';
  }

  return raw || 'Bilinmeyen bir hata oluştu.';
}

/**
 * 402 yanıtındaki PAYMENT-REQUIRED başlığından reddetme sebebini çıkarır.
 *
 * Ödeme denendikten sonra gelen 402'nin gövdesi boştur; facilitator'ın verdiği
 * gerçek sebep bu başlıktaki `error` alanındadır.
 */
function decodePaymentRequiredError(response: Response): string | null {
  const header =
    response.headers.get('payment-required') ??
    response.headers.get('x-payment-required');
  if (!header) return null;

  try {
    const decoded = JSON.parse(atob(header)) as { error?: unknown };
    return typeof decoded.error === 'string' ? decoded.error : null;
  } catch {
    return null;
  }
}

export default function PaymentForm() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { switchChainAsync } = useSwitchChain();

  const [tierId, setTierId] = useState<TierId>(TIERS[0].id);
  const [recipient, setRecipient] = useState("");
  const [isPaying, setIsPaying] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<PaymentStep>('idle');
  // Hata anında hangi aşamada kalındığını göstermek için; 'error' bunu kaybeder.
  const [failedAt, setFailedAt] = useState<PaymentStep>('signing');
  const [history, setHistory] = useState<PaymentRecord[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback((kind: ToastKind, text: string) => {
    setToasts((current) => [...current, { id: Date.now() + Math.random(), kind, text }]);
  }, []);

  const handlePay = async () => {
    if (!walletClient || !publicClient) {
      setError("Cüzdan bağlantısı bekleniyor. Lütfen tekrar deneyin.");
      return;
    }
    
    if (walletClient.chain?.id !== BASE_CHAIN_ID) {
      try {
        await switchChainAsync({ chainId: BASE_CHAIN_ID });
        setError("Ağ Base olarak değiştirildi. Lütfen işlemi tekrar başlatın.");
        return;
      } catch (err: any) {
        setError("Ağ değiştirilemedi. Lütfen manuel olarak Base ağına geçin.");
        return;
      }
    }
    
    if (recipient && !/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
      setError("Alıcı adresi geçersiz: 0x ile başlayan 40 haneli bir adres girin.");
      return;
    }

    const tier = TIERS.find((t) => t.id === tierId) ?? TIERS[0];

    setIsPaying(true);
    setError(null);
    setTxHash(null);
    setStep('signing');
    setFailedAt('signing');

    try {
      // 1. Prepare wagmi compatible signer for x402
      const clientSigner: ClientEvmSigner = {
        address: walletClient.account.address,
        signTypedData: async (msg) => {
          // x402 describes the EIP-712 payload with plain records, while viem
          // infers narrow TypedDataDefinition generics that cannot be rebuilt
          // from that shape. These two assertions are the only ones genuinely
          // required; they are confined to this boundary.
          const raw = await walletClient.signTypedData({
            account: walletClient.account,
            domain: msg.domain,
            types: msg.types,
            primaryType: msg.primaryType,
            message: msg.message,
          } as Parameters<typeof walletClient.signTypedData>[0]);

          const signature = normalizeRecoveryByte(raw);

          // The facilitator settles the EIP-3009 authorization by recovering the
          // payer from this signature. Verifying it here first turns an opaque
          // "invalid_exact_evm_signature" 402 into an actionable message, and
          // catches the two ways a browser wallet breaks this:
          //   - a smart-contract account signs via ERC-1271/6492, producing a
          //     blob that is not a 65-byte recoverable signature;
          //   - the wallet signs with an account other than the connected one.
          // An RPC hiccup must never block a payment that would have succeeded,
          // so only a definitive `false` is treated as a failure.
          let verified: boolean | null = null;
          try {
            verified = await publicClient.verifyTypedData({
              address: walletClient.account.address,
              domain: msg.domain,
              types: msg.types,
              primaryType: msg.primaryType,
              message: msg.message,
              signature,
            } as Parameters<typeof publicClient.verifyTypedData>[0]);
          } catch (e) {
            console.warn("İmza yerel olarak doğrulanamadı (RPC hatası), devam ediliyor:", e);
          }

          if (verified === false) {
            if (signature.length !== 132) {
              throw new Error(
                "Bu cüzdan akıllı kontrat hesabı imzası (ERC-1271/6492) üretti. " +
                "x402 EIP-3009 ödemesi, imzadan çözümlenebilen standart bir EOA hesabı gerektirir. " +
                "Lütfen normal bir cüzdan hesabıyla bağlanın."
              );
            }
            throw new Error(
              "Cüzdanın ürettiği imza ödeme yapan adrese çözümlenmiyor. " +
              "Cüzdanınızda imzalayan hesabın bağlı hesapla (" +
              `${walletClient.account.address.slice(0, 6)}...${walletClient.account.address.slice(-4)}) ` +
              "aynı olduğundan emin olun."
            );
          }

          return signature;
        },
        readContract: (args) =>
          publicClient.readContract(
            args as Parameters<typeof publicClient.readContract>[0]
          ),
      };

      // 2. Initialize x402 client
      const client = new x402Client();

      // 3. Register the payment schemes.
      // v2 uses CAIP-2 network ids ("eip155:8453"); v1 uses plain names ("base").
      // The facilitator picks the protocol version, and x402Client throws
      // "No client registered for x402 version: N" when that version is missing,
      // so both are registered.
      client.register("eip155:*", new ExactEvmScheme(clientSigner));
      // The metered tier is priced with the upto scheme, so its client
      // implementation must be registered or that 402 cannot be answered.
      client.register("eip155:*", new UptoEvmScheme(clientSigner));
      client.registerV1("base", new ExactEvmSchemeV1(clientSigner));

      // 4. Create an x402-wrapped fetch function
      const fetchWithPayment = wrapFetchWithPayment(window.fetch.bind(window), client);

      // 5. Pay this app's own x402-protected endpoint, settled by the CDP facilitator
      const apiUrl = tier.route;
      // İmza, wrapFetchWithPayment içindeki 402 turunda isteniyor; istek
      // dönene kadar cüzdan aşamasındayız.
      const response = await fetchWithPayment(apiUrl, {
        method: 'GET',
        // The server reads this to decide payTo, so the panel controls where the
        // payment lands. Omitted when blank, which falls back to the server's
        // configured recipient.
        headers: recipient ? { 'x-payment-recipient': recipient } : undefined,
      });

      setStep('verifying');

      if (!response.ok) {
        let errorBody = "";
        try {
          errorBody = await response.text();
        } catch (e) {}

        // Ödeme reddedildiğinde gövde boş bir {} olur; asıl sebep 402'nin
        // PAYMENT-REQUIRED başlığındaki `error` alanında gelir. Yalnızca
        // gövdeye bakmak kullanıcıya "Sunucu Hatası: 402 - {}" gösteriyordu.
        const reason = decodePaymentRequiredError(response);
        if (reason) errorBody = `${errorBody} ${reason}`;
        
        if (errorBody.includes("invalid_exact_evm_signature")) {
          throw new Error(
            "Ödeme imzası facilitator tarafından reddedildi. Bu genellikle imzanın " +
            "ödeme yapan adrese çözümlenmemesinden kaynaklanır: akıllı kontrat " +
            "cüzdanları (ERC-1271/6492) yerine standart bir EOA hesabı kullanın ve " +
            "cüzdanınızda Base ağının seçili olduğundan emin olun."
          );
        }

        if (errorBody.includes("invalid_exact_evm_transaction_simulation_failed")) {
          throw new Error("Ödeme simülasyonu başarısız oldu. Base ağında yeterli USDC bakiyeniz (en az 0.05 USDC) olduğundan emin olun.");
        }
        
        throw new Error(`Sunucu Hatası: ${response.status} ${response.statusText} - ${errorBody}`);
      }

      setStep('settling');

      // Settlement bilgisi PAYMENT-RESPONSE başlığında gelir. Buradaki eski kod
      // @x402/extensions'ın extractReceiptFromResponse'unu kullanıyordu; o
      // fonksiyon sunucunun bildirmediği offer-receipt eklentisine ait olduğu
      // için hep undefined dönüyor, dolayısıyla BaseScan linki gerçek bir hash
      // yerine sabit metne gidiyordu.
      let finalTxHash: string | null = null;
      try {
        const header =
          response.headers.get('x-payment-response') ??
          response.headers.get('payment-response');
        if (header) {
          const settlement = decodePaymentResponseHeader(header) as
            | { transaction?: string }
            | undefined;
          finalTxHash = settlement?.transaction ?? null;
        }
      } catch (e) {
        console.warn('Settlement başlığı çözülemedi', e);
      }

      setTxHash(finalTxHash);
      setStep('done');

      if (finalTxHash) {
        setHistory(
          appendRecord({
            txHash: finalTxHash,
            amount: tier.price,
            recipient: recipient || 'sunucu ayarı',
            timestamp: new Date().toISOString(),
            network: NETWORK,
          })
        );
      }

      pushToast('success', `Ödeme tamamlandı — ${tier.label} (${tier.price}).`);

    } catch (err) {
      console.error("Tam hata:", err);
      const message = describePaymentError(err);
      setFailedAt(step === 'error' ? failedAt : step);
      setStep('error');
      setError(message);
      pushToast('error', message);
    } finally {
      setIsPaying(false);
    }
  };

  return (
    <div className="w-full relative">
      <div className="bg-[#0d0d0d] border-2 border-emerald-500/30 p-6 sm:p-8 shadow-[0_0_50px_rgba(16,185,129,0.1)] relative">
        <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-emerald-500"></div>
        <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-emerald-500"></div>

        <div className="flex items-center justify-end mb-6 gap-2 flex-wrap">
          {!isConnected ? (
            connectors.map((connector) => (
              <button
                key={connector.uid}
                onClick={() => connect({ connector }, { onError: (err) => setError(`Bağlantı hatası: ${err.message}`) })}
                disabled={isConnecting}
                className="text-[10px] font-mono font-bold uppercase tracking-widest text-emerald-400 hover:text-emerald-300 flex items-center gap-2 transition-colors bg-emerald-500/10 hover:bg-emerald-500/20 py-2 px-4 border border-emerald-500/20"
              >
                {isConnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : `Connect ${connector.name}`}
              </button>
            ))
          ) : (
            <button
              onClick={() => disconnect()}
              className="text-[10px] font-mono uppercase tracking-widest text-gray-400 hover:text-gray-200 flex items-center gap-2 transition-colors bg-[#141414] hover:bg-[#222] py-2 px-4 border border-[#333]"
            >
              Disconnect <LogOut className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        
        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] font-mono uppercase text-gray-400 tracking-wider">
              Paket
            </label>
            <div className="grid grid-cols-3 gap-2">
              {TIERS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTierId(t.id)}
                  disabled={isPaying}
                  className={`px-2 py-2 border text-[10px] font-mono uppercase tracking-widest transition-colors disabled:opacity-50 ${
                    tierId === t.id
                      ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                      : 'bg-transparent border-[#333] text-gray-400 hover:border-gray-500'
                  }`}
                >
                  <span className="block font-bold">{t.label}</span>
                  <span className="block text-[9px] opacity-70">
                    {t.scheme === 'upto' ? `≤ ${t.price}` : t.price}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-[9px] font-mono text-gray-600 leading-relaxed">
              {TIERS.find((t) => t.id === tierId)?.description}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-mono uppercase text-gray-400 tracking-wider">Recipient Address (Ödeme bu adrese gider)</label>
            <input
              type="text"
              placeholder="0x… (boşsa sunucu ayarı kullanılır)"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value.trim())}
              className="w-full bg-black border border-[#222] px-4 py-3 font-mono text-sm focus:border-emerald-500 outline-none transition-colors text-white"
            />
          </div>

          <div className="pt-4">
            <div className="flex justify-between items-end mb-4 border-b border-[#222] pb-4">
              <span className="text-[10px] font-mono uppercase text-gray-500">Asset</span>
              <span className="font-bold text-white">Base USDC</span>
            </div>
            {step !== 'idle' && (
              <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono uppercase tracking-widest">
                {STEP_ORDER.map((s, i) => {
                  // Hata durumunda yalnızca ulaşılan aşamalar gösterilir:
                  // "Tamamlandı" ile "Başarısız"ı yan yana göstermek çelişkiliydi.
                  const failedIndex = STEP_ORDER.indexOf(failedAt);
                  if (step === 'error' && i > failedIndex) return null;

                  const currentIndex = STEP_ORDER.indexOf(step);
                  const isFailed = step === 'error' && i === failedIndex;
                  const reached = step === 'error' ? i <= failedIndex : currentIndex >= i;
                  const isActive = step === s && step !== 'done';

                  return (
                    <span
                      key={s}
                      className={`flex items-center gap-1.5 ${
                        isFailed
                          ? 'text-red-400'
                          : reached
                            ? 'text-emerald-400'
                            : 'text-gray-600'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isFailed
                            ? 'bg-red-500'
                            : isActive
                              ? 'bg-emerald-400 animate-pulse'
                              : reached
                                ? 'bg-emerald-500'
                                : 'bg-[#333]'
                        }`}
                      />
                      {isFailed
                        ? STEP_LABELS.error
                        : STEP_LABELS[s as Exclude<PaymentStep, 'idle'>]}
                    </span>
                  );
                })}
              </div>
            )}

            <button
              onClick={handlePay}
              disabled={isPaying || !isConnected}
              className={`w-full ${!isConnected ? 'bg-[#222] text-gray-500' : 'bg-emerald-500 hover:bg-emerald-400 text-black'} disabled:opacity-50 font-black uppercase py-5 text-sm tracking-widest transition-all active:scale-[0.98] flex items-center justify-center gap-2`}
            >
              {isPaying ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing...
                </>
              ) : !isConnected ? (
                "Connect Wallet to Pay"
              ) : (
                "Process Payment"
              )}
            </button>
          </div>

          {error && (
            <div className="flex items-center gap-3 bg-red-950/30 p-3 border border-red-500/20 text-red-400 text-[10px] font-mono uppercase">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <p>{error}</p>
            </div>
          )}
        </div>
      </div>

      {txHash && (
        <div className="mt-6 bg-emerald-900/10 border border-emerald-500/20 p-4 shadow-[0_0_30px_rgba(16,185,129,0.05)]">
          <div className="flex justify-between text-[11px] mb-2">
            <span className="text-emerald-400 font-bold uppercase flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> TX Status: Success
            </span>
            <a
              href={`https://basescan.org/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className="text-gray-500 hover:text-white transition-colors"
            >
              View on Basescan ↗
            </a>
          </div>
          <div className="font-mono text-[10px] text-gray-400 break-all">{txHash}</div>
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-6 bg-[#0a0a0a] border border-[#222] p-4">
          <div className="flex items-center justify-between mb-3 border-b border-[#222] pb-2">
            <h3 className="text-[10px] font-mono font-bold uppercase tracking-widest text-gray-300">
              İşlem Geçmişi
              <span className="text-gray-600 ml-2">({history.length})</span>
            </h3>
            <button
              onClick={() => setHistory(clearHistory())}
              className="text-[10px] font-mono uppercase tracking-widest text-gray-500 hover:text-red-400 transition-colors"
            >
              Temizle
            </button>
          </div>

          <ul className="max-h-56 overflow-y-auto divide-y divide-[#1a1a1a]">
            {history.map((record) => (
              <li
                key={record.txHash}
                className="flex items-center justify-between gap-3 py-2 text-[10px] font-mono"
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-emerald-400 font-bold">{record.amount}</span>
                  <span className="text-gray-500 truncate">
                    {record.recipient.startsWith('0x')
                      ? shortAddress(record.recipient)
                      : record.recipient}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-gray-600">{relativeTime(record.timestamp)}</span>
                  <a
                    href={`https://basescan.org/tx/${record.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-gray-500 hover:text-emerald-400 transition-colors"
                  >
                    Basescan ↗
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
