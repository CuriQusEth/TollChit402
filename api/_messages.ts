/**
 * Sunucunun kullanıcıya gösterdiği metinler — TR/EN.
 *
 * Yalnızca ARAYÜZDE görünen mesajlar burada. Günlüğe yazılanlar çevrilmiyor:
 * onları operatör okuyor ve tek dilde kalmaları aramayı kolaylaştırıyor.
 *
 * Varsayılan dil İngilizce; istemci hangi dili seçtiyse onu gönderiyor.
 */
export type ServerLang = "en" | "tr";

/** Gövdeden ya da başlıktan gelen değeri güvenli bir dile çevirir. */
export function readLang(value: unknown): ServerLang {
  return value === "tr" ? "tr" : "en";
}

type Vars = Record<string, string | number>;

const TEXTS = {
  // --- Bilet talebi ---
  mintingDisabled: {
    en: "Chit minting is not configured on this deployment. See /api/receipt-status for details.",
    tr: "Bilet basımı bu dağıtımda yapılandırılmamış. Ayrıntı için /api/receipt-status.",
  },
  badTxHash: {
    en: "Invalid transaction hash: it must start with 0x and be 64 characters long.",
    tr: "Geçersiz işlem hash'i: 0x ile başlayan 64 haneli olmalı.",
  },
  badSignature: { en: "Invalid signature format.", tr: "Geçersiz imza biçimi." },
  alreadyMinted: {
    en: "A chit has already been minted for this payment.",
    tr: "Bu ödeme için zaten bir bilet basılmış.",
  },
  txFailed: {
    en: "This transaction failed on chain; no chit can be minted for it.",
    tr: "Bu işlem zincirde başarısız olmuş; bilet basılamaz.",
  },
  txNotFound: {
    en: "This transaction was not found on Base. If it was sent moments ago, wait for it to be confirmed and try again.",
    tr: "Bu işlem Base ağında bulunamadı. Az önce gönderildiyse onaylanmasını bekleyip tekrar deneyin.",
  },
  noUsdcTransfer: {
    en: "This transaction contains no USDC transfer; it is not an x402 payment.",
    tr: "Bu işlemde USDC transferi yok; bir x402 ödemesi değil.",
  },
  notThePayer: {
    en: "The signature does not belong to the wallet that made this payment. Signer: {signer}. USDC sender(s) in this transaction: {senders}. Request the chit while connected with the wallet that paid.",
    tr: "İmza, bu ödemeyi yapan cüzdana ait değil. İmzalayan: {signer}. Bu işlemde USDC gönderen adres(ler): {senders}. Bilet talebini, ödemeyi yapan cüzdanla bağlanarak yapın.",
  },
  signerUnknown: { en: "could not be recovered", tr: "çözülemedi" },
  mintFailed: {
    en: "Could not mint the chit: {reason} Your payment is unaffected.",
    tr: "Bilet basılamadı: {reason} Ödemeniz bundan etkilenmez.",
  },

  // --- Basım hataları ---
  mintNoGas: {
    en: "The minting wallet does not have enough ETH for the transaction fee. Send it a small amount of ETH on Base.",
    tr: "Basım cüzdanında işlem ücreti için yeterli ETH yok. Base ağında o cüzdana bir miktar ETH gönderin.",
  },
  mintNotOwner: {
    en: "The minting wallet is not the contract owner; TollChit402.mint() is owner-only. RECEIPT_MINTER_PRIVATE_KEY must be the key of the wallet that deployed the contract.",
    tr: "Basım cüzdanı kontratın sahibi değil; TollChit402.mint() yalnızca sahibe açık. RECEIPT_MINTER_PRIVATE_KEY, kontratı dağıtan cüzdanın anahtarı olmalı.",
  },
  mintNoContract: {
    en: "The expected contract was not found at the given address. Check that TOLLCHIT_CONTRACT_ADDRESS is the TollChit402 address on Base mainnet.",
    tr: "Verilen adreste beklenen kontrat bulunamadı. TOLLCHIT_CONTRACT_ADDRESS Base mainnet'teki TollChit402 adresi mi, kontrol edin.",
  },
  mintRpc: {
    en: "Base RPC could not be reached. Setting your own BASE_RPC_URL avoids the rate limits on public endpoints.",
    tr: "Base RPC'sine ulaşılamadı. Kendi BASE_RPC_URL'inizi tanımlamak genel uçlardaki hız sınırını aşar.",
  },
  mintNonce: {
    en: "The minting wallet's nonce drifted from the chain and the automatic retries were not enough. If the wallet has a pending (unmined) transaction, try again once it goes through.",
    tr: "Basım cüzdanının nonce'u zincirdekiyle ayrıştı ve otomatik denemeler de yetmedi. Cüzdanda bekleyen (madenlenmemiş) bir işlem varsa o geçtikten sonra tekrar deneyin.",
  },
  mintNodeSaid: { en: "{summary} — the node said: {detail}", tr: "{summary} — düğümün yanıtı: {detail}" },

  // --- Yapılandırma ---
  configMissing: {
    en: "Chit minting is not configured on the server (TOLLCHIT_CONTRACT_ADDRESS and RECEIPT_MINTER_PRIVATE_KEY are unset)",
    tr: "Sunucuda bilet basımı yapılandırılmamış (TOLLCHIT_CONTRACT_ADDRESS ve RECEIPT_MINTER_PRIVATE_KEY tanımlı değil)",
  },
  configNoContract: {
    en: "TOLLCHIT_CONTRACT_ADDRESS is not set (the former name RECEIPT_CONTRACT_ADDRESS is read too)",
    tr: "TOLLCHIT_CONTRACT_ADDRESS tanımlı değil (eski adı RECEIPT_CONTRACT_ADDRESS da okunur)",
  },
  configBadContract: {
    en: 'TOLLCHIT_CONTRACT_ADDRESS is invalid: "{value}"',
    tr: 'TOLLCHIT_CONTRACT_ADDRESS geçersiz: "{value}"',
  },
  configNoKey: {
    en: "RECEIPT_MINTER_PRIVATE_KEY is not set",
    tr: "RECEIPT_MINTER_PRIVATE_KEY tanımlı değil",
  },
  configBadKey: {
    en: "RECEIPT_MINTER_PRIVATE_KEY is invalid (must be 0x + 64 characters)",
    tr: "RECEIPT_MINTER_PRIVATE_KEY geçersiz (0x + 64 hane olmalı)",
  },
  // --- Teşhis sayfası ---
  docTitle: { en: "TollChit402 minting diagnostics", tr: "TollChit402 bilet basımı teşhisi" },
  docAllOk: {
    en: "Every check passed. Minting should work; if chits still do not arrive, look at the [receipt] lines in the server logs.",
    tr: "Her kontrol başarılı. Basım çalışmalı; yine de bilet gelmiyorsa sunucu loglarındaki [receipt] satırlarına bakın.",
  },
  docFailed: {
    en: "{count} check(s) failed — the “→” lines below say what to do.",
    tr: "{count} kontrol başarısız — aşağıdaki “→” satırları ne yapılacağını söylüyor.",
  },
  docPassed: { en: "Passing checks", tr: "Başarılı kontroller" },
  docSubtitle: {
    en: "This page checks the configuration and the chain without making a payment",
    tr: "Bu sayfa ödeme yapmadan yapılandırmayı ve zinciri kontrol eder",
  },
  docRawJson: { en: "Raw JSON", tr: "Ham JSON" },
  docLocalRun: { en: "The same checks locally", tr: "Yerelde aynı kontroller" },
  docOtherLang: { en: "Türkçe", tr: "English" },
  docSummaryOk: { en: "All checks passed.", tr: "Tüm kontroller başarılı." },
  docSummaryFail: {
    en: "At least one check failed — follow the → lines above.",
    tr: "En az bir kontrol başarısız — yukarıdaki → satırlarını izleyin.",
  },

  docContract: { en: "Contract address", tr: "Kontrat adresi" },
  docContractInvalid: { en: 'invalid: "{value}"  ({source})', tr: 'geçersiz: "{value}"  ({source})' },
  docContractLegacy: {
    en: "It works, but the variable still has its old name; rename it to TOLLCHIT_CONTRACT_ADDRESS.",
    tr: "Çalışıyor ama değişken eski adıyla duruyor; TOLLCHIT_CONTRACT_ADDRESS olarak yeniden adlandırın.",
  },
  docContractFix: {
    en: "Minting is off. Add the deployed TollChit402 address to the environment variables (on Vercel: Settings > Environment Variables, then redeploy).",
    tr: "Basım kapalı. Dağıtılmış TollChit402 adresini ortam değişkenlerine ekleyin (Vercel'de Settings > Environment Variables, ardından yeniden dağıtım).",
  },

  docKeySet: { en: "set, format valid", tr: "tanımlı ve biçimi geçerli" },
  docKeyBad: { en: "invalid format", tr: "geçersiz biçim" },
  docUnset: { en: "not set", tr: "tanımlı değil" },
  docKeyFix: {
    en: "It must be the private key of the wallet that owns the contract: 0x + 64 characters.",
    tr: "Kontratın sahibi olan cüzdanın private key'i olmalı: 0x + 64 hane.",
  },
  docRpcDefault: {
    en: "(unset — using the public RPC)",
    tr: "(tanımsız — public RPC kullanılıyor)",
  },
  docPublicUrlFix: {
    en: "Set the site's permanent address (e.g. https://your-site.vercel.app). While unset, the chit data is embedded on chain: ~3.6 million gas per mint, and the node may reject the transaction.",
    tr: "Sitenin kalıcı adresini yazın (örn. https://siteniz.vercel.app). Tanımsızken bilet verisi zincire gömülüyor: basım başına ~3,6 milyon gaz ve işlem düğüm tarafından reddedilebiliyor.",
  },

  docMinter: { en: "Minting wallet", tr: "Basım cüzdanı" },
  docRpcNetwork: { en: "RPC network", tr: "RPC ağı" },
  docWrongNetwork: {
    en: "Base mainnet ({expected}) was expected. BASE_RPC_URL points at the wrong network.",
    tr: "Base mainnet ({expected}) bekleniyordu. BASE_RPC_URL yanlış ağa bakıyor.",
  },
  docRpcReach: { en: "RPC reachability", tr: "RPC erişimi" },
  docRpcReachFix: {
    en: "The RPC endpoint cannot be reached. Is BASE_RPC_URL correct and reachable?",
    tr: "RPC adresine ulaşılamıyor. BASE_RPC_URL doğru ve erişilebilir mi?",
  },
  docBytecode: { en: "Contract bytecode", tr: "Kontrat bytecode" },
  docBytecodeFix: {
    en: "The address is wrong, or the contract is deployed on another network (e.g. Base Sepolia).",
    tr: "Adres yanlış ya da kontrat başka bir ağa (örn. Base Sepolia) dağıtılmış.",
  },
  docMintedCount: { en: "{count} chits minted", tr: "{count} bilet basılmış" },
  docAbiFix: {
    en: "The contract at this address is not TollChit402, or the ABI does not match.",
    tr: "Bu adresteki kontrat TollChit402 değil ya da ABI eşleşmiyor.",
  },
  docSymbolFix: {
    en: "{expected} was expected; this may be the wrong contract.",
    tr: "{expected} bekleniyordu; yanlış kontrat olabilir.",
  },
  docOwner: { en: "owner() == minting wallet", tr: "owner() == basım cüzdanı" },
  docOwnerDetail: {
    en: "contract owner {owner}, minting wallet {minter}",
    tr: "kontrat sahibi {owner}, basım cüzdanı {minter}",
  },
  docOwnerFix: {
    en: "mint() is onlyOwner. Either redeploy the contract with the correct initialOwner, or call transferOwnership({minter}) from the current owner.",
    tr: "mint() onlyOwner. Ya kontratı doğru initialOwner ile yeniden dağıtın, ya da mevcut sahiple transferOwnership({minter}) çağırın.",
  },
  docBalance: { en: "Minting wallet ETH balance", tr: "Basım cüzdanı ETH bakiyesi" },
  docBalanceFix: {
    en: "This wallet pays the minting gas (the payer's payment is gasless). Send it ETH on Base.",
    tr: "Basım gazını bu cüzdan öder (alıcının ödemesi gazsızdır). Base ağında ETH gönderin.",
  },
  docSimulation: { en: "mint() simulation", tr: "mint() simülasyonu" },
  docSimulationOk: {
    en: "succeeded, next tokenId {id}",
    tr: "başarılı, sıradaki tokenId {id}",
  },
  docSimNotOwner: {
    en: "The minting wallet is not the contract owner.",
    tr: "Basım cüzdanı kontratın sahibi değil.",
  },
  docSimNoGas: {
    en: "The minting wallet has no ETH for gas.",
    tr: "Basım cüzdanında gaz için ETH yok.",
  },
  docSimOther: {
    en: "The contract rejects the call; the reason is in the full error text above.",
    tr: "Kontrat çağrıyı reddediyor; sebep yukarıdaki tam hata metninde.",
  },

  badReceiver: {
    en: 'Recipient address is invalid: "{value}"',
    tr: 'Alıcı adresi geçersiz: "{value}"',
  },
} as const;

export type TextId = keyof typeof TEXTS;

/** Metni verilen dilde döndürür; `{ad}` yer tutucularını doldurur. */
export function msg(lang: ServerLang, id: TextId, vars?: Vars): string {
  const template: string = TEXTS[id][lang];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  );
}
