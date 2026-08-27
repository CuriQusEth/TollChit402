/**
 * Ödeme makbuzu NFT'sinin basımı.
 *
 * Her başarılı settlement'tan sonra ödemeyi yapan cüzdana ücretsiz bir ERC-721
 * makbuz basılır (contracts/PaymentReceipt.sol). Makbuz ödemenin zincir üstü
 * kanıtıdır ve alıcının kendi cüzdanında durur.
 *
 * DİKKAT — ALICININ ÖDEMESİ GAZSIZDIR, BASIM DEĞİLDİR. Alıcı EIP-3009 ile
 * yalnızca imza atar; gazı facilitator öder. Buradaki basım ise gerçek bir
 * zincir üstü yazma işlemidir ve gazını PROJE öder. Bu yüzden basım cüzdanının
 * (RECEIPT_MINTER_PRIVATE_KEY) Base ağında bir miktar ETH bulundurması ve elle
 * doldurulması gerekir; bakiye bittiğinde basım sessizce başarısız olur, ödeme
 * akışı etkilenmez.
 *
 * Bu modüldeki her şey en-iyi-çabadır: hiçbir hata dışarı fırlatılmaz, sorun
 * çıkarsa `null` döner. Başarısız bir basım, tamamlanmış bir ödemenin alıcıya
 * başarısız görünmesine ASLA sebep olmamalı.
 */
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  nonceManager,
  type Hex,
} from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;

/**
 * Basımın toplam süre sınırı.
 *
 * Çağıran taraf ayrıca kendi (çok daha kısa) süresiyle yarışır; bu sınır arka
 * planda devam eden basımın sonsuza kadar asılı kalmamasını sağlar.
 */
const MINT_DEADLINE_MS = 45_000;

/** Kontratın yalnızca ihtiyacımız olan parçası. */
const RECEIPT_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "uri", type: "string" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "nextTokenId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "setTokenURI",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "uri", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "ReceiptMinted",
    inputs: [
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
  },
] as const;

export type ReceiptMint = {
  tokenId: string;
  txHash: string;
};

export type ReceiptParams = {
  /** Makbuzun gideceği adres — ödemeyi yapan cüzdan. */
  to: string;
  /** Ödemenin yapıldığı paket (shared/tiers.ts'teki id). */
  tierId: string;
  /** Tahsil edilen tutar, dolar olarak: "0.0031". */
  amountUsd: string;
  /** CAIP-2 ağ kimliği: "eip155:8453". */
  network: string;
};

/** Yapılandırma eksikse her istekte değil, süreç başına bir kez uyar. */
let warnedAboutConfig = false;

/**
 * Basım için gereken yapılandırmayı okur.
 *
 * Makbuz özelliği isteğe bağlıdır: iki değişken de tanımlı değilse özellik
 * kapalıdır ve ödemeler her zamanki gibi çalışır.
 */
function readConfig():
  | { contract: `0x${string}`; key: `0x${string}` }
  | null {
  const contract = process.env.RECEIPT_CONTRACT_ADDRESS?.trim();
  const key = process.env.RECEIPT_MINTER_PRIVATE_KEY?.trim();

  if (!contract && !key) return null; // Özellik kapalı; bu bir hata değil.

  const problem = !contract
    ? "RECEIPT_CONTRACT_ADDRESS tanımlı değil"
    : !EVM_ADDRESS.test(contract)
      ? `RECEIPT_CONTRACT_ADDRESS geçersiz: "${contract}"`
      : !key
        ? "RECEIPT_MINTER_PRIVATE_KEY tanımlı değil"
        : !PRIVATE_KEY.test(key)
          ? "RECEIPT_MINTER_PRIVATE_KEY geçersiz (0x + 64 hane olmalı)"
          : null;

  if (problem) {
    if (!warnedAboutConfig) {
      warnedAboutConfig = true;
      console.warn(`[receipt] Makbuz basımı kapalı: ${problem}.`);
    }
    return null;
  }

  return { contract: contract as `0x${string}`, key: key as `0x${string}` };
}

/** Makbuz özelliğinin yapılandırılıp yapılandırılmadığını bildirir. */
export function isReceiptMintingConfigured(): boolean {
  return readConfig() !== null;
}

/** Arayüzün BaseScan bağlantısı kurabilmesi için kontrat adresi. */
export function receiptContractAddress(): string | null {
  return readConfig()?.contract ?? null;
}

/** SVG/JSON içine gömülen metni zararsız hâle getirir. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

/** Seri numarasını "000007" biçiminde altı haneye tamamlar. */
function serialOf(tokenId: bigint): string {
  return tokenId.toString().padStart(6, "0");
}

/**
 * Makbuzun görselini üretir: yırtılan bir bilet koçanı.
 *
 * Solda perforasyonla ayrılmış koçan (mini bariyer + ADMIT ONE), sağda ana
 * bilet (TOLLCHIT + X402 rozeti + tutar + seri numarası). Biçim konsepti
 * anlatıyor: her ödeme tek seferlik bir geçiş hakkı, seri numarası da o
 * geçişin sırası.
 *
 * Tamamen zincir üstünde durabilmesi için satır içi SVG: IPFS ya da Pinata
 * gibi bir dış barındırıcıya bağımlılık yok, dolayısıyla makbuz o servis
 * kapansa da görüntülenebilir kalır.
 */
function receiptSvg(
  params: ReceiptParams,
  mintedAt: Date,
  tokenId: bigint
): string {
  const tier = escapeXml(params.tierId.toUpperCase());
  const amount = escapeXml(params.amountUsd);
  const network = escapeXml(params.network);
  const date = escapeXml(mintedAt.toISOString().slice(0, 19).replace("T", " "));
  const payer = escapeXml(`${params.to.slice(0, 6)}…${params.to.slice(-4)}`);
  const serial = serialOf(tokenId);

  // Arayüzdeki token'ların birebir aynısı (src/index.css).
  const BG = "#050505";
  const SURFACE = "#0a0a0a";
  const BORDER = "#2a2a2a";
  const TEXT = "#f5f5f5";
  const MUTED = "#8b8f98";
  const DIM = "#6b7280";
  const ACCENT = "#10b981";

  const MONO = "ui-monospace,SFMono-Regular,Menlo,monospace";
  const STUB_X = 168; // perforasyon çizgisinin yeri

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="260" viewBox="0 0 640 260">',
    `<rect width="640" height="260" fill="${BG}"/>`,

    // Bilet gövdesi
    `<rect x="16" y="16" width="608" height="228" rx="8" fill="${SURFACE}" stroke="${BORDER}" stroke-width="2"/>`,

    // Perforasyon: üst ve alt yarım daire çentikler + kesik çizgi
    `<circle cx="${STUB_X}" cy="16" r="11" fill="${BG}"/>`,
    `<circle cx="${STUB_X}" cy="244" r="11" fill="${BG}"/>`,
    `<path d="M${STUB_X} 34V226" stroke="${BORDER}" stroke-width="2" stroke-dasharray="6 7" stroke-linecap="round"/>`,

    `<g font-family="${MONO}">`,

    // --- KOÇAN ---
    // Mini bariyer: kol kalkmış, geçiş verilmiş
    `<g transform="translate(58 74) scale(0.78)">`,
    `<path d="M0 44h56" stroke="${BORDER}" stroke-width="2.5" stroke-linecap="round"/>`,
    `<g transform="rotate(-38 10 28)">`,
    `<rect x="10" y="24" width="40" height="9" rx="2" fill="${ACCENT}"/>`,
    `<path d="M20 24v9M30 24v9M40 24v9" stroke="${SURFACE}" stroke-width="3"/>`,
    "</g>",
    `<circle cx="10" cy="28" r="3.2" fill="${SURFACE}" stroke="${ACCENT}" stroke-width="2"/>`,
    `<rect x="2" y="8" width="17" height="13" rx="2" fill="${SURFACE}" stroke="${BORDER}" stroke-width="1.5"/>`,
    `<text x="10.5" y="18" font-size="8" font-weight="700" fill="${TEXT}" text-anchor="middle">402</text>`,
    `<rect x="7" y="21" width="6" height="23" fill="${BG}" stroke="${BORDER}" stroke-width="1.5"/>`,
    "</g>",
    `<path d="M52 148h80" stroke="${BORDER}" stroke-width="1"/>`,
    `<text x="92" y="176" font-size="13" font-weight="700" fill="${MUTED}" text-anchor="middle" letter-spacing="3">ADMIT ONE</text>`,
    `<text x="92" y="198" font-size="10" fill="${DIM}" text-anchor="middle" letter-spacing="2">NO. ${serial}</text>`,

    // --- ANA BİLET ---
    `<text x="200" y="70" font-size="30" font-weight="700" fill="${TEXT}" letter-spacing="1">TOLLCHIT</text>`,

    // X402 rozeti — emerald çerçeve
    `<rect x="516" y="44" width="76" height="32" rx="4" fill="none" stroke="${ACCENT}" stroke-width="2"/>`,
    `<text x="554" y="66" font-size="16" font-weight="700" fill="${ACCENT}" text-anchor="middle" letter-spacing="2">X402</text>`,

    `<path d="M200 92h392" stroke="${BORDER}" stroke-width="1"/>`,

    // Tutar
    `<text x="200" y="146" font-size="46" font-weight="700" fill="${TEXT}">$${amount}</text>`,

    // Alan satırı
    `<text x="200" y="186" font-size="9" fill="${DIM}" letter-spacing="2">TIER</text>`,
    `<text x="200" y="204" font-size="11" fill="${MUTED}">${tier}</text>`,
    `<text x="330" y="186" font-size="9" fill="${DIM}" letter-spacing="2">NETWORK</text>`,
    `<text x="330" y="204" font-size="11" fill="${MUTED}">${network}</text>`,
    `<text x="470" y="186" font-size="9" fill="${DIM}" letter-spacing="2">PAYER</text>`,
    `<text x="470" y="204" font-size="11" fill="${MUTED}">${payer}</text>`,

    `<text x="200" y="228" font-size="9" fill="${DIM}" letter-spacing="2">${date} UTC</text>`,
    `<text x="592" y="228" font-size="11" font-weight="700" fill="${MUTED}" text-anchor="end" letter-spacing="2">NO. ${serial}</text>`,

    "</g>",
    "</svg>",
  ].join("");
}

/**
 * Tamamen zincir üstü tokenURI'yi üretir.
 *
 * Kontrat paketlerden habersizdir; paket, tutar, ağ, seri numarası ve zaman
 * damgası burada metadata'nın `attributes` alanına konur, böylece yeni bir
 * paket eklemek kontratı değiştirmeyi gerektirmez.
 *
 * @param tokenId Bilete yazılacak seri numarası. Basımdan ÖNCE bilinmesi
 *   gerekiyor çünkü görselin içinde duruyor; çağıran taraf bunu kontrattan
 *   `nextTokenId()` ile okur ve basımdan sonra doğrular.
 */
export function buildTokenUri(
  params: ReceiptParams,
  mintedAt: Date,
  tokenId: bigint
): string {
  const image = `data:image/svg+xml;base64,${toBase64(receiptSvg(params, mintedAt, tokenId))}`;

  const metadata = {
    name: `TOLLCHIT No. ${serialOf(tokenId)} — ${params.tierId} ($${params.amountUsd})`,
    description:
      "Toll402Pay bileti: Base mainnet üzerinde x402 protokolüyle yapılmış bir " +
      "mikro ödemenin zincir üstü makbuzu. Ödeme doğrulanıp settle edildikten " +
      "sonra otomatik olarak basılmıştır. Her bilet tek bir ödemeye aittir ve " +
      "seri numarası o ödemenin sırasıdır.",
    image,
    attributes: [
      { trait_type: "Serial", value: serialOf(tokenId) },
      { trait_type: "Tier", value: params.tierId },
      { trait_type: "Amount (USD)", value: params.amountUsd },
      { trait_type: "Network", value: params.network },
      {
        trait_type: "Timestamp",
        display_type: "date",
        value: Math.floor(mintedAt.getTime() / 1000),
      },
    ],
  };

  return `data:application/json;base64,${toBase64(JSON.stringify(metadata))}`;
}

/** Basım işleminin loglarından token kimliğini çıkarır. */
function tokenIdFromLogs(logs: readonly unknown[]): string | null {
  for (const entry of logs) {
    // viem'in Base makbuz tipinde `topics` jenerik daralması yüzünden düşüyor;
    // çalışma zamanında alan her zaman var. Assertion yalnızca bu sınırda.
    const log = entry as { data: Hex; topics: [Hex, ...Hex[]] };
    try {
      const decoded = decodeEventLog({
        abi: RECEIPT_ABI,
        eventName: "ReceiptMinted",
        data: log.data,
        topics: log.topics,
      });
      return decoded.args.tokenId.toString();
    } catch {
      // Başka bir olay (Transfer gibi); atlanır.
    }
  }
  return null;
}

/**
 * Yanlış seri numarasıyla basılmış bir bileti doğru numarayla yeniden yazar.
 *
 * En-iyi-çaba: başarısız olursa yalnızca günlüğe düşer. Bilet zaten basılmış
 * ve geçerlidir; düzeltilen tek şey görseldeki numara.
 */
async function repairTokenUri(
  ctx: {
    walletClient: ReturnType<typeof createWalletClient>;
    account: ReturnType<typeof privateKeyToAccount>;
    contract: `0x${string}`;
  },
  params: ReceiptParams,
  mintedAt: Date,
  tokenId: bigint
): Promise<void> {
  try {
    const hash = await ctx.walletClient.writeContract({
      address: ctx.contract,
      abi: RECEIPT_ABI,
      functionName: "setTokenURI",
      args: [tokenId, buildTokenUri(params, mintedAt, tokenId)],
      account: ctx.account,
      chain: base,
      type: "eip1559",
      kzg: undefined,
    });
    console.log(`[receipt] Bilet #${tokenId} seri numarası düzeltildi (${hash})`);
  } catch (err) {
    console.error(`[receipt] Bilet #${tokenId} düzeltilemedi:`, err);
  }
}

/**
 * Ödemeyi yapana bir makbuz basar.
 *
 * @returns Basılan makbuz, ya da basım yapılamadıysa `null`. Bu fonksiyon
 *   hiçbir koşulda fırlatmaz.
 */
export async function mintReceipt(params: ReceiptParams): Promise<ReceiptMint | null> {
  const config = readConfig();
  if (!config) return null;

  if (!EVM_ADDRESS.test(params.to)) {
    console.warn(`[receipt] Alıcı adresi geçersiz, basım atlandı: "${params.to}"`);
    return null;
  }

  try {
    const transport = http(process.env.BASE_RPC_URL || undefined);
    // nonceManager, aynı anda settle olan iki ödemenin aynı nonce'u kullanıp
    // birinin düşmesini engelliyor.
    const account = privateKeyToAccount(config.key, { nonceManager });
    const publicClient = createPublicClient({ chain: base, transport });
    const walletClient = createWalletClient({ account, chain: base, transport });

    const mintedAt = new Date();

    // Seri numarası biletin görselinde duruyor, ama kimliği mint atarken
    // kontrat veriyor. Bu yüzden numara önce okunuyor; basımdan sonra da
    // gerçekten o numaranın verildiği doğrulanıyor (aşağıda).
    const predictedId = (await publicClient.readContract({
      address: config.contract,
      abi: RECEIPT_ABI,
      functionName: "nextTokenId",
      // `authorizationList: undefined` yalnızca tip düzeyinde gerekiyor:
      // strictNullChecks kapalı olduğu için viem'in koşullu tipi bu isteğe
      // bağlı alanı zorunlu sayıyor (deploy.ts'teki kzg notuyla aynı sebep).
      authorizationList: undefined,
    })) as bigint;

    const uri = buildTokenUri(params, mintedAt, predictedId);

    const txHash = await walletClient.writeContract({
      address: config.contract,
      abi: RECEIPT_ABI,
      functionName: "mint",
      args: [params.to as `0x${string}`, uri],
      account,
      chain: base,
      // Kontrat çağrısı normal bir EIP-1559 işlemi. `kzg: undefined` yalnızca
      // tip düzeyinde gerekiyor (bkz. contracts/scripts/deploy.ts'teki not).
      type: "eip1559",
      kzg: undefined,
    });

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: MINT_DEADLINE_MS,
    });

    if (receipt.status !== "success") {
      console.warn(`[receipt] Basım işlemi revert etti: ${txHash}`);
      return null;
    }

    const tokenId = tokenIdFromLogs(receipt.logs);
    if (!tokenId) {
      // İşlem başarılı ama olay okunamadı: makbuz basıldı, kimliği bilinmiyor.
      // Yanıta eksik bir kayıt koymaktansa hiç koymamak daha doğru.
      console.warn(`[receipt] ReceiptMinted olayı okunamadı: ${txHash}`);
      return null;
    }

    // Aynı anda iki basım araya girerse tahmin tutmayabilir. Kalıcı bir ödeme
    // kanıtının üzerinde yanlış seri numarası durmasındansa, doğru numarayla
    // yeniden yazılması yeğdir. Nadir bir yol; ödemeyi hiç ilgilendirmiyor,
    // bu yüzden yanıt beklemeden arka planda yapılıyor.
    if (tokenId !== predictedId.toString()) {
      console.warn(
        `[receipt] Seri numarası kaydı: tahmin #${predictedId}, verilen #${tokenId}. ` +
          "Bilet doğru numarayla yeniden yazılıyor."
      );
      void repairTokenUri(
        { walletClient, account, contract: config.contract },
        params,
        mintedAt,
        BigInt(tokenId)
      );
    }

    console.log(`[receipt] Bilet #${tokenId} basıldı → ${params.to} (${txHash})`);
    return { tokenId, txHash };
  } catch (err) {
    // Gaz bitmiş, RPC düşmüş, alıcı ERC-721 kabul etmeyen bir kontrat olabilir.
    // Hiçbiri ödemeyi ilgilendirmez: ödeme çoktan zincire yazıldı.
    console.error("[receipt] Makbuz basılamadı:", err);
    return null;
  }
}
