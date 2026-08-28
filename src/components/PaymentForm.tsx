import { useCallback, useEffect, useState } from 'react';
import { useAccount, useConnect, useDisconnect, useWalletClient, usePublicClient, useSwitchChain } from 'wagmi';
import { Loader2, CheckCircle2, AlertCircle, LogOut, Ticket, Sparkles } from 'lucide-react';
import { x402Client, wrapFetchWithPayment, decodePaymentResponseHeader } from '@x402/fetch';
import type { ClientEvmSigner } from '@x402/evm';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { UptoEvmScheme } from '@x402/evm/upto/client';
import { ExactEvmSchemeV1 } from '@x402/evm/v1';
import ToastStack, { type ToastMessage, type ToastKind } from './Toast';
import { TIERS, type TierId } from '../../shared/tiers';
import Button from './ui/Button';
import Card from './ui/Card';
import {
  appendRecord,
  clearHistory,
  loadHistory,
  relativeTime,
  shortAddress,
  updateRecord,
  type PaymentRecord,
} from '../lib/paymentHistory';

const BASE_CHAIN_ID = 8453;
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
 * Ödemeden sonra basılan TollChit402 bileti (ERC-721, sembol CHIT402).
 *
 * Sunucu bu alanı yalnızca makbuz özelliği açıkken yanıta ekler ve basım
 * yapılamadıysa `null` gönderir; arayüz ikisini de sessizce karşılar.
 */
type Receipt = {
  tokenId: string;
  txHash: string;
  contract: string;
};

/** Bir geçmiş satırındaki bilet talebinin durumu. */
type ChitRequest =
  | { state: 'signing' }
  | { state: 'minting' }
  | { state: 'error'; message: string };

/**
 * Sunucunun imzalamamızı istediği mesaj.
 *
 * api/_mint-request.ts'teki mintRequestMessage ile birebir aynı olmalı; tek
 * karakter farkı imzayı geçersiz kılar.
 */
function mintRequestMessage(txHash: string): string {
  return [
    'TollChit402 makbuz talebi',
    '',
    `İşlem: ${txHash}`,
    '',
    'Bu imza yalnızca ödemenin size ait olduğunu kanıtlar.',
    'Cüzdanınızdan para çıkmaz ve gaz ödemezsiniz.',
  ].join('\n');
}

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
function describePaymentError(err: unknown, priceLabel: string): string {
  const error = err as { code?: number; message?: string; cause?: { code?: number } };
  const code = error?.code ?? error?.cause?.code;
  const raw = error?.message ?? '';

  if (code === 4001 || /user rejected|user denied|rejected the request/i.test(raw)) {
    return 'İşlemi cüzdanınızda reddettiniz. Ödeme yapılmadı.';
  }

  if (/insufficient (funds|balance)|transfer amount exceeds balance/i.test(raw)) {
    return `Yetersiz bakiye. Base ağında bu paket için en az ${priceLabel} tutarında USDC bulundurmanız gerekiyor.`;
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
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<PaymentStep>('idle');
  // Hata anında hangi aşamada kalındığını göstermek için; 'error' bunu kaybeder.
  const [failedAt, setFailedAt] = useState<PaymentStep>('signing');
  const [history, setHistory] = useState<PaymentRecord[]>([]);
  // txHash -> o satırdaki bilet talebinin durumu.
  const [chitRequests, setChitRequests] = useState<Record<string, ChitRequest>>({});
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

  /**
   * Bir geçmiş ödeme için bilet bastırır.
   *
   * Sunucu, basımın gazını proje ödediği için talebi korumasız kabul etmiyor:
   * önce cüzdanla bir mesaj imzalanıyor (gazsız), sunucu imzadan adresi
   * kurtarıp o adresin gerçekten bu işlemdeki USDC transferini yapan taraf
   * olduğunu zincirden doğruluyor.
   */
  const requestChit = async (record: PaymentRecord) => {
    if (!walletClient) {
      setChitRequests((c) => ({
        ...c,
        [record.txHash]: { state: 'error', message: 'Önce cüzdanınızı bağlayın.' },
      }));
      return;
    }

    setChitRequests((c) => ({ ...c, [record.txHash]: { state: 'signing' } }));

    try {
      const signature = await walletClient.signMessage({
        account: walletClient.account,
        message: mintRequestMessage(record.txHash),
      });

      setChitRequests((c) => ({ ...c, [record.txHash]: { state: 'minting' } }));

      const response = await fetch('/api/mint-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txHash: record.txHash,
          signature,
          tierId: record.tierId,
        }),
      });

      const data = (await response.json()) as {
        receipt?: Receipt;
        message?: string;
      };

      if (!response.ok || !data.receipt?.tokenId) {
        throw new Error(data.message || `Bilet basılamadı (${response.status}).`);
      }

      // Kayda yazılıyor ki sayfa yenilendiğinde de bilet görünsün.
      setHistory(updateRecord(record.txHash, { chit: data.receipt }));
      setChitRequests((c) => {
        const next = { ...c };
        delete next[record.txHash];
        return next;
      });
      pushToast('success', `Bilet #${data.receipt.tokenId} cüzdanınıza basıldı.`);
    } catch (err) {
      const message = describePaymentError(err, '');
      setChitRequests((c) => ({
        ...c,
        [record.txHash]: { state: 'error', message },
      }));
    }
  };

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

    // Facilitator kendine transferi reddediyor (self_send_not_allowed). Bunu
    // imza istemeden önce yakalamak, kullanıcıyı boş yere cüzdan açtırmaktan
    // kurtarır.
    if (
      recipient &&
      address &&
      recipient.toLowerCase() === address.toLowerCase()
    ) {
      setError(
        "Alıcı adresi ödeme yapan cüzdanla aynı. Kendinize ödeme yapamazsınız — " +
        "farklı bir adres girin ya da alanı boş bırakıp sunucu ayarını kullanın."
      );
      return;
    }

    const tier = TIERS.find((t) => t.id === tierId) ?? TIERS[0];

    setIsPaying(true);
    setError(null);
    setTxHash(null);
    setReceipt(null);
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
              // Akıllı kontrat cüzdanları toptan reddedilmez: facilitator,
              // DAĞITILMIŞ bir hesabın ERC-1271 imzasını doğrulayabilir.
              // Sorun yalnızca hesap henüz zincire yazılmamışsa (ERC-6492)
              // ve facilitator o factory'yi allowlist'ine almamışsa çıkar.
              throw new Error(
                "Bu cüzdan akıllı kontrat hesabı imzası (ERC-1271/6492) üretti ve imza " +
                "yerel olarak doğrulanamadı. Hesabınız henüz zincire dağıtılmadıysa " +
                "önce herhangi bir işlemle dağıtın; dağıtılmış akıllı cüzdanlar bu " +
                "ödemeyi yapabilir. Alternatif olarak standart bir EOA hesabıyla bağlanın."
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
            "Ödeme imzası facilitator tarafından reddedildi. İmza, ödeme yapan " +
            "adrese çözümlenmiyor. Sık görülen sebepler: cüzdanda bağlı olandan " +
            "başka bir hesabın imzalaması, seçili ağın Base olmaması, ya da akıllı " +
            "cüzdan hesabının henüz zincire dağıtılmamış olması."
          );
        }

        if (errorBody.includes("self_send_not_allowed")) {
          throw new Error(
            "Facilitator kendine yapılan ödemeyi reddetti: alıcı adres, ödeme yapan " +
            "cüzdanla aynı. Farklı bir alıcı adresi girin."
          );
        }

        if (
          errorBody.includes("invalid_exact_evm_payload_signature") ||
          errorBody.includes("execution reverted")
        ) {
          throw new Error(
            "Ödeme akıllı kontrat cüzdanından yapılıyor ve facilitator imzayı " +
            "doğrulayamadı. EIP-3009 digest'i doğrudan hesabın isValidSignature " +
            "fonksiyonuna veriliyor; Coinbase Smart Wallet gibi hesaplar imzayı " +
            "kendi sarmalayıcı biçiminde beklediği için bu çağrı revert ediyor. " +
            "Lütfen standart bir EOA cüzdanıyla (MetaMask/Rabby'de normal hesap) " +
            "bağlanın."
          );
        }

        if (errorBody.includes("eip6492_factory_not_allowed")) {
          throw new Error(
            "Cüzdanınız henüz zincire dağıtılmamış bir akıllı hesap (ERC-6492) ve " +
            "facilitator bu hesabın factory'sini kabul etmiyor. Hesabı herhangi bir " +
            "işlemle dağıttıktan sonra tekrar deneyin — dağıtılmış akıllı cüzdanlar " +
            "ERC-1271 ile doğrulanır."
          );
        }

        if (errorBody.includes("invalid_exact_evm_transaction_simulation_failed")) {
          throw new Error(`Ödeme simülasyonu başarısız oldu. Base ağında yeterli USDC bakiyeniz (bu paket için en az ${tier.price}) olduğundan emin olun.`);
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

      // Makbuz, ödemenin yanıt gövdesinde gelir (bkz. api/_receipt-response.ts).
      // Özellik kapalıysa alan hiç yoktur, basım yetişmediyse null gelir —
      // ikisinde de kart gösterilmez, çünkü ödemenin kendisi başarılı.
      // Yerel değişken: setReceipt eşzamanlı güncellenmediği için aşağıdaki
      // appendRecord state'i okuyamaz, bileti buradan alması gerekiyor.
      let mintedChit: Receipt | null = null;
      try {
        const body = (await response.json()) as { receipt?: Receipt | null };
        if (body?.receipt?.tokenId) {
          mintedChit = body.receipt;
          setReceipt(body.receipt);
        }
      } catch (e) {
        console.warn('Yanıt gövdesi okunamadı', e);
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
            tierId: tier.id,
            // Otomatik basım yetiştiyse bileti kayda da geçir; düğme o satırda
            // "zaten basıldı" durumuna düşer.
            ...(mintedChit ? { chit: mintedChit } : {}),
          })
        );
      }

      pushToast('success', `Ödeme tamamlandı — ${tier.label} (${tier.price}).`);

    } catch (err) {
      console.error("Tam hata:", err);
      const message = describePaymentError(err, tier.price);
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
      {/* Terminal paneli. Kenarlık ve köşe işaretleri artık emerald değil:
          hiçbir durum bildirmiyorlardı ve emerald'i her yere dağıtmak, gerçekten
          "ödendi" diyen yerlerde göze çarpmasını engelliyordu. */}
      <div className="bg-surface border-2 border-border-strong rounded-sm p-6 sm:p-8 relative">
        <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-border-strong"></div>
        <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-border-strong"></div>

        <div className="flex items-center justify-end mb-6 gap-2 flex-wrap">
          {!isConnected ? (
            connectors.map((connector) => (
              <Button
                key={connector.uid}
                lang="en"
                variant="secondary"
                onClick={() => connect({ connector }, { onError: (err) => setError(`Bağlantı hatası: ${err.message}`) })}
                disabled={isConnecting}
              >
                {isConnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : `Connect ${connector.name}`}
              </Button>
            ))
          ) : (
            <Button lang="en" variant="secondary" onClick={() => disconnect()}>
              Disconnect <LogOut className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
        
        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-label uppercase text-muted tracking-wider">
              Paket
            </label>
            <div className="grid grid-cols-3 gap-2">
              {TIERS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTierId(t.id)}
                  disabled={isPaying}
                  className={`px-2 py-2 border rounded-sm text-label uppercase tracking-widest transition-colors disabled:opacity-50 ${
                    // Seçili paket emerald: "etkin" gerçek bir durum.
                    tierId === t.id
                      ? 'bg-accent-surface border-accent text-accent'
                      : 'bg-transparent border-border text-muted hover:border-border-strong'
                  }`}
                >
                  <span lang="en" className="block font-bold">{t.label}</span>
                  <span className="block text-label opacity-70">
                    {t.scheme === 'upto' ? `≤ ${t.price}` : t.price}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-label text-dim leading-relaxed">
              {TIERS.find((t) => t.id === tierId)?.description}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-label uppercase text-muted tracking-wider">
              <span lang="en">Recipient Address</span> (Ödeme bu adrese gider)
            </label>
            <input
              type="text"
              placeholder="0x… (boşsa sunucu ayarı kullanılır)"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value.trim())}
              className="w-full bg-bg border border-border rounded-sm px-4 py-3 text-body focus:border-border-strong outline-none transition-colors text-text"
            />
          </div>

          <div className="pt-4">
            <div lang="en" className="flex justify-between items-end mb-4 border-b border-border pb-4">
              <span className="text-label uppercase text-dim">Asset</span>
              <span className="text-body font-bold text-text">Base USDC</span>
            </div>
            {step !== 'idle' && (
              <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-label uppercase tracking-widest">
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
                        // Emerald burada anlamlı: aşama gerçekten tamamlandı.
                        isFailed ? 'text-danger' : reached ? 'text-accent' : 'text-dim'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isFailed
                            ? 'bg-danger'
                            : isActive
                              ? 'bg-accent animate-pulse'
                              : reached
                                ? 'bg-accent'
                                : 'bg-border-strong'
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

            {/* Tek `primary` düğme: emerald "geçişe izin ver" demek, o yüzden
                yalnızca ödemeyi başlatan eylemde. */}
            <Button
              lang="en"
              variant="primary"
              size="lg"
              onClick={handlePay}
              disabled={isPaying || !isConnected}
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
            </Button>
          </div>

          {error && (
            <Card tone="danger" className="flex items-center gap-3 p-3 text-danger text-label uppercase">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <p>{error}</p>
            </Card>
          )}
        </div>
      </div>

      {txHash && (
        <Card tone="accent" className="mt-6">
          <div lang="en" className="flex justify-between text-body mb-2">
            <span className="text-accent font-bold uppercase flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> TX Status: Success
            </span>
            <a
              href={`https://basescan.org/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className="text-dim hover:text-text transition-colors"
            >
              View on Basescan ↗
            </a>
          </div>
          <div className="text-label text-muted break-all">{txHash}</div>
        </Card>
      )}

      {receipt && (
        <Card tone="accent" className="mt-6">
          <div lang="en" className="flex justify-between text-body mb-2">
            <span className="text-accent font-bold uppercase flex items-center gap-1.5">
              <Ticket className="w-3.5 h-3.5" /> TollChit402 Minted 🎫
            </span>
            <a
              href={`https://basescan.org/nft/${receipt.contract}/${receipt.tokenId}`}
              target="_blank"
              rel="noreferrer"
              className="text-dim hover:text-text transition-colors"
            >
              View CHIT402 on Basescan ↗
            </a>
          </div>
          <div className="text-label text-muted">
            Bilet #{receipt.tokenId} cüzdanınıza basıldı — ödemenin zincir üstü kanıtı.
          </div>
        </Card>
      )}

      {history.length > 0 && (
        <Card className="mt-6">
          <div className="flex items-center justify-between mb-3 border-b border-border pb-2">
            <h3 className="text-label font-bold uppercase tracking-widest text-text">
              İşlem Geçmişi
              <span className="text-dim ml-2">({history.length})</span>
            </h3>
            <Button variant="ghost" size="sm" onClick={() => setHistory(clearHistory())}>
              Temizle
            </Button>
          </div>

          <ul className="max-h-56 overflow-y-auto divide-y divide-border">
            {history.map((record) => {
              const request = chitRequests[record.txHash];
              const busy = request?.state === 'signing' || request?.state === 'minting';

              return (
                <li key={record.txHash} className="py-2 text-label">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      {/* Tutar emerald: bu satır tamamlanmış bir ödeme. */}
                      <span className="text-accent font-bold">{record.amount}</span>
                      <span className="text-muted truncate">
                        {record.recipient.startsWith('0x')
                          ? shortAddress(record.recipient)
                          : record.recipient}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-dim">{relativeTime(record.timestamp)}</span>
                      <a
                        href={`https://basescan.org/tx/${record.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-dim hover:text-text transition-colors"
                      >
                        Basescan ↗
                      </a>
                    </div>
                  </div>

                  {record.chit ? (
                    // Bilet zaten var: emerald, çünkü tamamlanmış bir durum.
                    <a
                      href={`https://basescan.org/nft/${record.chit.contract}/${record.chit.tokenId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 flex items-center gap-1.5 text-accent hover:brightness-125 transition-all"
                    >
                      <Ticket className="w-3 h-3" />
                      Bilet #{record.chit.tokenId} — Basescan'de gör ↗
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => requestChit(record)}
                      disabled={busy || !isConnected}
                      title={
                        isConnected
                          ? 'Ödemeyi yaptığınız cüzdanla bir mesaj imzalarsınız; gaz ödemezsiniz.'
                          : 'Bilet talebi için cüzdanınızı bağlayın.'
                      }
                      className="mt-2 flex items-center gap-1.5 text-muted hover:text-text transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {busy ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Sparkles className="w-3 h-3" />
                      )}
                      {request?.state === 'signing'
                        ? 'Cüzdanda imzalayın…'
                        : request?.state === 'minting'
                          ? 'Bilet basılıyor…'
                          : 'Makbuzu NFT olarak bastır'}
                    </button>
                  )}

                  {request?.state === 'error' && (
                    <p className="mt-1.5 text-danger leading-relaxed">{request.message}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
