/**
 * Arayüzün dil katmanı — TR/EN.
 *
 * Varsayılan dil İngilizce. Seçim tarayıcıda saklanıyor; ilk ziyarette
 * tarayıcı dili Türkçe ise Türkçe açılıyor, diğer her durumda İngilizce.
 *
 * DİKKAT — TÜRKÇE BÜYÜK HARF: CSS'teki `text-transform: uppercase`, kök
 * öğede `lang="tr"` varken "i" harfini "İ" yapıyor. Bu yüzden İngilizce
 * kalan öğelere (marka adı, protokol terimleri) `lang="en"` yazılıyor;
 * o işaretler dil değişince de yerinde kalmalı.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type FC,
  type ReactNode,
} from "react";

export type Lang = "en" | "tr";

const STORAGE_KEY = "tollchit402.lang";

/**
 * Metinler. Anahtarlar İngilizce metnin kendisi değil, kısa kimlikler:
 * İngilizce bir cümle değiştiğinde Türkçesinin sessizce eskimemesi için.
 */
const MESSAGES = {
  en: {
    "lang.switch": "Türkçe'ye geç",
    "lang.short": "TR",

    "tier.basic.description":
      "A demo endpoint paid with x402 on Base mainnet; returns JSON once the payment is verified.",
    "tier.pro.description":
      "An extended demo response: returns the payment details along with the package information.",
    "tier.metered.description":
      "Usage-based endpoint: pass a unit count with ?units=, and only the amount actually used is charged, up to the cap.",

    "gm.title": "Good Morning, Base",
    "gm.blurb":
      "The opposite of the paid endpoint above: free, open to everyone, no payment and no sign-in. Say gm once a day; call it on consecutive days and your streak grows, skip a day and it resets.",
    "gm.total": "Total GMs",
    "gm.streak": "Your Streak",
    "gm.say": "Say gm",
    "gm.sending": "Sending…",
    "gm.already": "You already said gm today — come back tomorrow.",
    "gm.connect": "Connect your wallet to say gm",
    "gm.done": "gm is on chain. See you tomorrow.",
    "gm.rejected": "You rejected the transaction in your wallet.",
    "gm.gasNote":
      "Unlike the payment above, this one is not gasless: gm is an ordinary transaction sent from your wallet, so you pay its gas. It costs a fraction of a cent on Base.",
    "gm.contract": "Contract on Basescan ↗",

    "hero.terminal": "Transaction Terminal",
    "hero.pay": "Pay",
    "hero.blurb":
      "Facilitating secure micro-transactions on the {base} via the {protocol}.",
    "hero.base": "Base L2",
    "hero.protocol": "x402 Payment Protocol",
    "stat.networkFee": "Network Fee",
    "stat.confirmations": "Confirmations",
    "stat.confirmationsValue": "~2 SEC",

    "footer.protocol": "Protocol Version: 1.0.42-STABLE",
    "footer.copyright": "© 2026 {brand} // Base Ecosystem",
    "footer.facilitator": "Facilitator: x402 protocol",

    "step.signing": "Signing in wallet",
    "step.verifying": "Verifying payment",
    "step.settling": "Settling on chain",
    "step.done": "Complete",
    "step.error": "Failed",

    "wallet.connect": "Connect {name}",
    "wallet.disconnect": "Disconnect",

    "form.tier": "Package",
    "form.recipient": "Recipient Address",
    "form.recipientHint": "(payment goes to this address)",
    "form.recipientPlaceholder": "0x… (server default if empty)",
    "form.asset": "Asset",

    "btn.processing": "Processing…",
    "btn.connectToPay": "Connect Wallet to Pay",
    "btn.pay": "Process Payment",

    "tx.status": "TX Status: Success",
    "tx.view": "View on Basescan ↗",

    "chit.row": "Chit #{id} — view on Basescan ↗",
    "chit.mint": "Mint receipt as an NFT",
    "chit.signing": "Sign in your wallet…",
    "chit.minting": "Minting chit…",
    "chit.hintConnected":
      "You sign a message with the wallet that paid; you pay no gas.",
    "chit.hintDisconnected": "Connect your wallet to request a chit.",
    "chit.toast": "Chit #{id} minted to your wallet.",

    "history.title": "Transaction History",
    "history.clear": "Clear",
    "history.serverDefault": "server default",

    "stats.title": "Payment Statistics",
    "stats.unavailable": "Statistics are unavailable right now.",
    "stats.total": "Total Payments",
    "stats.volume": "Total Volume",
    "stats.ephemeral":
      "Persistent storage (Vercel KV) is not configured — counters are kept in memory and reset on every restart.",
    "stats.leaderboard": "Builder Code leaderboard",
    "stats.fetchFailed": "Could not load statistics ({status})",

    "time.now": "just now",
    "time.minutes": "{n}m ago",
    "time.hours": "{n}h ago",
    "time.days": "{n}d ago",

    "pay.toast": "Payment complete — {tier} ({price}).",

    "err.rejected": "You rejected the request in your wallet. No payment was made.",
    "err.insufficient":
      "Insufficient balance. You need at least {price} of USDC on Base for this package.",
    "err.unknown": "Something went wrong.",
    "err.connectFirst": "Connect your wallet first.",
    "err.walletPending": "Waiting for the wallet connection. Please try again.",
    "err.chainSwitched": "Network switched to Base. Please start the payment again.",
    "err.chainSwitchFailed": "Could not switch networks. Please switch to Base manually.",
    "err.badRecipient":
      "Invalid recipient address: enter a 40-character address starting with 0x.",
    "err.selfPay":
      "The recipient address is the same as the paying wallet. You cannot pay yourself — enter a different address, or leave the field empty to use the server default.",
    "err.scaUnverified":
      "This wallet produced a smart-contract account signature (ERC-1271/6492) that could not be verified locally. If your account is not deployed on chain yet, deploy it with any transaction first; deployed smart wallets can make this payment. Alternatively, connect with a standard EOA account.",
    "err.signerMismatch":
      "The signature the wallet produced does not resolve to the paying address. Make sure the signing account in your wallet is the same as the connected account ({address}).",
    "err.facilitatorSignature":
      "The facilitator rejected the payment signature: it does not resolve to the paying address. Common causes: an account other than the connected one signed, the selected network is not Base, or the smart wallet account is not deployed on chain yet.",
    "err.selfSend":
      "The facilitator rejected a payment to yourself: the recipient address is the same as the paying wallet. Enter a different recipient address.",
    "err.transferReverted":
      "The facilitator's USDC transfer reverted on chain. Your wallet is a normal account, so this is not a signature-format problem. The usual causes: not enough USDC on Base (this package needs {price}), or the payment authorization was already used. Facilitator's reason: {reason}",
    "err.smartWallet":
      "The payment comes from a smart-contract wallet and the facilitator could not verify the signature. The EIP-3009 digest is passed straight to the account's isValidSignature function, and accounts such as Coinbase Smart Wallet expect the signature in their own wrapper format, so that call reverts. Please connect with a standard EOA wallet (a regular account in MetaMask/Rabby).",
    "err.undeployed6492":
      "Your wallet is a smart account that is not deployed on chain yet (ERC-6492), and the facilitator does not accept this account's factory. Deploy the account with any transaction and try again — deployed smart wallets are verified via ERC-1271.",
    "err.simulationFailed":
      "The payment simulation failed. Make sure you have enough USDC on Base (at least {price} for this package).",
    "err.server": "Server error: {status} {statusText} — {body}",
    "err.connect": "Connection error: {message}",
    "err.mintFailed": "Could not mint the chit ({status}).",
  },

  tr: {
    "lang.switch": "Switch to English",
    "lang.short": "EN",

    "tier.basic.description":
      "Base mainnet üzerinde x402 ile ödenen demo endpoint; ödeme doğrulandıktan sonra JSON döner.",
    "tier.pro.description":
      "Genişletilmiş demo yanıtı: ödeme ayrıntıları ve paket bilgisiyle birlikte döner.",
    "tier.metered.description":
      "Kullanım bazlı uç: ?units= ile birim sayısı verilir, tavana kadar yalnızca kullanılan tutar tahsil edilir.",

    "gm.title": "Günaydın Base",
    "gm.blurb":
      "Yukarıdaki ücretli ucun tam tersi: ücretsiz, herkese açık, ödeme de kimlik doğrulama da istemiyor. Günde bir kez gm deyin; ardışık günlerde derseniz seriniz büyür, gün atlarsanız sıfırlanır.",
    "gm.total": "Toplam GM",
    "gm.streak": "Seriniz",
    "gm.say": "gm de",
    "gm.sending": "Gönderiliyor…",
    "gm.already": "Bugün zaten gm dediniz — yarın tekrar bekleriz.",
    "gm.connect": "gm demek için cüzdanınızı bağlayın",
    "gm.done": "gm zincire yazıldı. Yarın görüşürüz.",
    "gm.rejected": "İşlemi cüzdanınızda reddettiniz.",
    "gm.gasNote":
      "Yukarıdaki ödemenin aksine bu gazsız değil: gm, cüzdanınızdan gönderilen sıradan bir işlem, gazını siz ödersiniz. Base'de bir sentin küçük bir kesri tutar.",
    "gm.contract": "Kontratı Basescan'de gör ↗",

    "hero.terminal": "İşlem Terminali",
    "hero.pay": "Öde",
    "hero.blurb":
      "{protocol} ile {base} üzerinde güvenli mikro ödemeler.",
    "hero.base": "Base L2",
    "hero.protocol": "x402 Ödeme Protokolü",
    "stat.networkFee": "Ağ Ücreti",
    "stat.confirmations": "Onay Süresi",
    "stat.confirmationsValue": "~2 SN",

    "footer.protocol": "Protokol Sürümü: 1.0.42-STABLE",
    "footer.copyright": "© 2026 {brand} // Base Ekosistemi",
    "footer.facilitator": "Facilitator: x402 protocol",

    "step.signing": "Cüzdanda imzalanıyor",
    "step.verifying": "Ödeme doğrulanıyor",
    "step.settling": "Zincire yazılıyor",
    "step.done": "Tamamlandı",
    "step.error": "Başarısız",

    "wallet.connect": "{name} ile bağlan",
    "wallet.disconnect": "Bağlantıyı kes",

    "form.tier": "Paket",
    "form.recipient": "Alıcı Adresi",
    "form.recipientHint": "(Ödeme bu adrese gider)",
    "form.recipientPlaceholder": "0x… (boşsa sunucu ayarı kullanılır)",
    "form.asset": "Varlık",

    "btn.processing": "İşleniyor…",
    "btn.connectToPay": "Ödemek için cüzdanı bağlayın",
    "btn.pay": "Ödemeyi başlat",

    "tx.status": "İşlem Durumu: Başarılı",
    "tx.view": "Basescan'de gör ↗",

    "chit.row": "Bilet #{id} — Basescan'de gör ↗",
    "chit.mint": "Makbuzu NFT olarak bastır",
    "chit.signing": "Cüzdanda imzalayın…",
    "chit.minting": "Bilet basılıyor…",
    "chit.hintConnected":
      "Ödemeyi yaptığınız cüzdanla bir mesaj imzalarsınız; gaz ödemezsiniz.",
    "chit.hintDisconnected": "Bilet talebi için cüzdanınızı bağlayın.",
    "chit.toast": "Bilet #{id} cüzdanınıza basıldı.",

    "history.title": "İşlem Geçmişi",
    "history.clear": "Temizle",
    "history.serverDefault": "sunucu ayarı",

    "stats.title": "Ödeme İstatistikleri",
    "stats.unavailable": "İstatistikler şu anda okunamıyor.",
    "stats.total": "Toplam Ödeme",
    "stats.volume": "Toplam Hacim",
    "stats.ephemeral":
      "Kalıcı depolama (Vercel KV) yapılandırılmamış — sayaçlar bellekte tutuluyor ve her yeniden başlatmada sıfırlanıyor.",
    "stats.leaderboard": "Builder Code sıralaması",
    "stats.fetchFailed": "İstatistikler alınamadı ({status})",

    "time.now": "az önce",
    "time.minutes": "{n} dk önce",
    "time.hours": "{n} sa önce",
    "time.days": "{n} gün önce",

    "pay.toast": "Ödeme tamamlandı — {tier} ({price}).",

    "err.rejected": "İşlemi cüzdanınızda reddettiniz. Ödeme yapılmadı.",
    "err.insufficient":
      "Yetersiz bakiye. Base ağında bu paket için en az {price} tutarında USDC bulundurmanız gerekiyor.",
    "err.unknown": "Bilinmeyen bir hata oluştu.",
    "err.connectFirst": "Önce cüzdanınızı bağlayın.",
    "err.walletPending": "Cüzdan bağlantısı bekleniyor. Lütfen tekrar deneyin.",
    "err.chainSwitched": "Ağ Base olarak değiştirildi. Lütfen işlemi tekrar başlatın.",
    "err.chainSwitchFailed": "Ağ değiştirilemedi. Lütfen manuel olarak Base ağına geçin.",
    "err.badRecipient":
      "Alıcı adresi geçersiz: 0x ile başlayan 40 haneli bir adres girin.",
    "err.selfPay":
      "Alıcı adresi ödeme yapan cüzdanla aynı. Kendinize ödeme yapamazsınız — farklı bir adres girin ya da alanı boş bırakıp sunucu ayarını kullanın.",
    "err.scaUnverified":
      "Bu cüzdan akıllı kontrat hesabı imzası (ERC-1271/6492) üretti ve imza yerel olarak doğrulanamadı. Hesabınız henüz zincire dağıtılmadıysa önce herhangi bir işlemle dağıtın; dağıtılmış akıllı cüzdanlar bu ödemeyi yapabilir. Alternatif olarak standart bir EOA hesabıyla bağlanın.",
    "err.signerMismatch":
      "Cüzdanın ürettiği imza ödeme yapan adrese çözümlenmiyor. Cüzdanınızda imzalayan hesabın bağlı hesapla ({address}) aynı olduğundan emin olun.",
    "err.facilitatorSignature":
      "Ödeme imzası facilitator tarafından reddedildi. İmza, ödeme yapan adrese çözümlenmiyor. Sık görülen sebepler: cüzdanda bağlı olandan başka bir hesabın imzalaması, seçili ağın Base olmaması, ya da akıllı cüzdan hesabının henüz zincire dağıtılmamış olması.",
    "err.selfSend":
      "Facilitator kendine yapılan ödemeyi reddetti: alıcı adres, ödeme yapan cüzdanla aynı. Farklı bir alıcı adresi girin.",
    "err.transferReverted":
      "Facilitator'ın USDC transferi zincirde revert etti. Cüzdanınız sıradan bir hesap, yani bu bir imza biçimi sorunu değil. Sık görülen sebepler: Base ağında yeterli USDC olmaması (bu paket için {price} gerekiyor) ya da ödeme yetkilendirmesinin daha önce kullanılmış olması. Facilitator'ın verdiği sebep: {reason}",
    "err.smartWallet":
      "Ödeme akıllı kontrat cüzdanından yapılıyor ve facilitator imzayı doğrulayamadı. EIP-3009 digest'i doğrudan hesabın isValidSignature fonksiyonuna veriliyor; Coinbase Smart Wallet gibi hesaplar imzayı kendi sarmalayıcı biçiminde beklediği için bu çağrı revert ediyor. Lütfen standart bir EOA cüzdanıyla (MetaMask/Rabby'de normal hesap) bağlanın.",
    "err.undeployed6492":
      "Cüzdanınız henüz zincire dağıtılmamış bir akıllı hesap (ERC-6492) ve facilitator bu hesabın factory'sini kabul etmiyor. Hesabı herhangi bir işlemle dağıttıktan sonra tekrar deneyin — dağıtılmış akıllı cüzdanlar ERC-1271 ile doğrulanır.",
    "err.simulationFailed":
      "Ödeme simülasyonu başarısız oldu. Base ağında yeterli USDC bakiyeniz (bu paket için en az {price}) olduğundan emin olun.",
    "err.server": "Sunucu hatası: {status} {statusText} — {body}",
    "err.connect": "Bağlantı hatası: {message}",
    "err.mintFailed": "Bilet basılamadı ({status}).",
  },
} as const;

export type MessageKey = keyof (typeof MESSAGES)["en"];

type Vars = Record<string, string | number>;

/** `{ad}` yer tutucularını doldurur. */
function fill(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  );
}

type I18n = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** Metni verilen dilde döndürür. */
  t: (key: MessageKey, vars?: Vars) => string;
  /**
   * Metni, yer tutucuları React öğeleriyle değiştirerek döndürür.
   *
   * Cümledeki sıra dile göre değişebildiği için parça parça birleştirmek
   * yerine şablonun kendisi bölünüyor.
   */
  tNode: (key: MessageKey, nodes: Record<string, ReactNode>) => ReactNode;
};

const I18nContext = createContext<I18n | null>(null);

/** İlk açılışta kullanılacak dil. Varsayılan İngilizce. */
function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "tr") return saved;
  } catch {
    // Gizli sekme ya da depolama kapalı; varsayılana düşülür.
  }

  try {
    if (navigator.language?.toLowerCase().startsWith("tr")) return "tr";
  } catch {
    // navigator yoksa varsayılan.
  }

  return "en";
}

export const LanguageProvider: FC<{ children?: ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    // Kök öğedeki lang, ekran okuyucular ve Türkçe büyük harf kuralı için.
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Saklanamadıysa da dil bu oturumda değişmiş olur.
    }
  }, []);

  const value = useMemo<I18n>(() => {
    const t = (key: MessageKey, vars?: Vars) => fill(MESSAGES[lang][key], vars);

    const tNode = (key: MessageKey, nodes: Record<string, ReactNode>) => {
      const parts = MESSAGES[lang][key].split(/(\{\w+\})/g);
      return parts.map((part, index) => {
        const match = /^\{(\w+)\}$/.exec(part);
        const node = match ? nodes[match[1]] : null;
        return <span key={index}>{node ?? part}</span>;
      });
    };

    return { lang, setLang, t, tNode };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18n {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n, LanguageProvider içinde çağrılmalı.");
  return context;
}
