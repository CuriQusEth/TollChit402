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

/**
 * Makbuzun görselini üretir.
 *
 * Tamamen zincir üstünde durabilmesi için satır içi SVG: IPFS ya da Pinata gibi
 * bir dış barındırıcıya bağımlılık yok, dolayısıyla makbuz o servis kapansa da
 * görüntülenebilir kalır.
 */
function receiptSvg(params: ReceiptParams, mintedAt: Date): string {
  const tier = escapeXml(params.tierId.toUpperCase());
  const amount = escapeXml(params.amountUsd);
  const network = escapeXml(params.network);
  const date = escapeXml(mintedAt.toISOString().slice(0, 19).replace("T", " "));
  const payer = escapeXml(`${params.to.slice(0, 6)}…${params.to.slice(-4)}`);

  // Arayüzdeki terminal/mono/emerald dili.
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 480 480">',
    '<rect width="480" height="480" fill="#050505"/>',
    '<rect x="16" y="16" width="448" height="448" fill="none" stroke="#10b981" stroke-width="2"/>',
    '<g font-family="ui-monospace,SFMono-Regular,Menlo,monospace">',
    '<text x="40" y="72" fill="#10b981" font-size="13" letter-spacing="4">X402 PAYMENT RECEIPT</text>',
    `<text x="40" y="176" fill="#ffffff" font-size="64" font-weight="bold">$${amount}</text>`,
    '<line x1="40" y1="212" x2="440" y2="212" stroke="#222"/>',
    '<text x="40" y="256" fill="#6b7280" font-size="11" letter-spacing="3">TIER</text>',
    `<text x="200" y="256" fill="#d1d5db" font-size="11">${tier}</text>`,
    '<text x="40" y="292" fill="#6b7280" font-size="11" letter-spacing="3">NETWORK</text>',
    `<text x="200" y="292" fill="#d1d5db" font-size="11">${network}</text>`,
    '<text x="40" y="328" fill="#6b7280" font-size="11" letter-spacing="3">PAYER</text>',
    `<text x="200" y="328" fill="#d1d5db" font-size="11">${payer}</text>`,
    '<text x="40" y="364" fill="#6b7280" font-size="11" letter-spacing="3">PAID AT</text>',
    `<text x="200" y="364" fill="#d1d5db" font-size="11">${date} UTC</text>`,
    '<text x="40" y="432" fill="#374151" font-size="10" letter-spacing="2">PROOF OF PAYMENT — BASE MAINNET</text>',
    "</g>",
    "</svg>",
  ].join("");
}

/**
 * Tamamen zincir üstü tokenURI'yi üretir.
 *
 * Kontrat paketlerden habersizdir; paket, tutar, ağ ve zaman damgası burada
 * metadata'nın `attributes` alanına konur, böylece yeni bir paket eklemek
 * kontratı değiştirmeyi gerektirmez.
 */
export function buildTokenUri(params: ReceiptParams, mintedAt: Date): string {
  const image = `data:image/svg+xml;base64,${toBase64(receiptSvg(params, mintedAt))}`;

  const metadata = {
    name: `x402 Payment Receipt — ${params.tierId} ($${params.amountUsd})`,
    description:
      "Base mainnet üzerinde x402 protokolüyle yapılmış bir mikro ödemenin " +
      "zincir üstü makbuzu. Ödeme doğrulanıp settle edildikten sonra otomatik " +
      "olarak basılmıştır.",
    image,
    attributes: [
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
    const uri = buildTokenUri(params, mintedAt);

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

    console.log(`[receipt] Makbuz #${tokenId} basıldı → ${params.to} (${txHash})`);
    return { tokenId, txHash };
  } catch (err) {
    // Gaz bitmiş, RPC düşmüş, alıcı ERC-721 kabul etmeyen bir kontrat olabilir.
    // Hiçbiri ödemeyi ilgilendirmez: ödeme çoktan zincire yazıldı.
    console.error("[receipt] Makbuz basılamadı:", err);
    return null;
  }
}
