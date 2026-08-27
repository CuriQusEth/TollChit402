/**
 * TollChit402 bileti (ERC-721) basımı.
 *
 * Her başarılı settlement'tan sonra ödemeyi yapan cüzdana ücretsiz bir
 * TollChit402 bileti basılır (contracts/TollChit402.sol, sembol CHIT402).
 * Bilet ödemenin zincir üstü kanıtıdır ve alıcının kendi cüzdanında durur.
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

/**
 * Dağıtılan TollChit402 kontratının yalnızca ihtiyacımız olan parçası.
 *
 * Kontratta `nextTokenId()` ve `setTokenURI()` YOK; kimlikler 0'dan başlayıp
 * post-increment ilerliyor ve basım olayı `ChitMinted(tokenId, to, uri)`.
 * Bu ABI o kontratla birebir eşleşmeli — eşleşmezse basım sessizce başarısız
 * olur (ödeme etkilenmez, ama bilet hiç görünmez).
 */
const TOLLCHIT_ABI = [
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
    name: "totalMinted",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "ChitMinted",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "uri", type: "string", indexed: false },
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
  const contract = process.env.TOLLCHIT_CONTRACT_ADDRESS?.trim();
  const key = process.env.RECEIPT_MINTER_PRIVATE_KEY?.trim();

  if (!contract && !key) return null; // Özellik kapalı; bu bir hata değil.

  const problem = !contract
    ? "TOLLCHIT_CONTRACT_ADDRESS tanımlı değil"
    : !EVM_ADDRESS.test(contract)
      ? `TOLLCHIT_CONTRACT_ADDRESS geçersiz: "${contract}"`
      : !key
        ? "RECEIPT_MINTER_PRIVATE_KEY tanımlı değil"
        : !PRIVATE_KEY.test(key)
          ? "RECEIPT_MINTER_PRIVATE_KEY geçersiz (0x + 64 hane olmalı)"
          : null;

  if (problem) {
    if (!warnedAboutConfig) {
      warnedAboutConfig = true;
      console.warn(`[receipt] Bilet basımı kapalı: ${problem}.`);
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
    `<text x="200" y="70" font-size="28" font-weight="700" fill="${TEXT}" letter-spacing="1">TOLLCHIT402</text>`,

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
    name: `TollChit402 No. ${serialOf(tokenId)} — ${params.tierId} ($${params.amountUsd})`,
    description:
      "TollChit402 bileti: Base mainnet üzerinde x402 protokolüyle yapılmış bir " +
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

/**
 * Bir sonraki biletin kimliğini ayırır.
 *
 * Kontratta `nextTokenId()` yok; `totalMinted()` sayacın kendisini döndürüyor ve
 * kimlikler 0'dan post-increment ilerlediği için bir sonraki kimlik ona eşit.
 * Ama sayacı her basımda zincirden okumak yetmez: ardışık iki ödeme, birincinin
 * işlemi daha madenlenmeden okursa ikisi de aynı sayıyı görür ve biletlerden
 * birinin üzerine yanlış numara yazılır. Kontratta `setTokenURI` de olmadığı
 * için bu sonradan düzeltilemez.
 *
 * Bu yüzden sayaç bir kez zincirden okunup süreç içinde ilerletiliyor ve
 * ayırma işlemi sıraya sokuluyor. Uyuşmazlıkta ya da hatada sıfırlanıp yeniden
 * okunuyor.
 *
 * Sınır: aynı cüzdanla basan ikinci bir süreç (örneğin ikinci bir serverless
 * örneği) varsa sayaç kayabilir. Uyuşmazlık yakalanıp günlüğe yazılır ve sayaç
 * kendini toparlar, ama o tek biletin görselindeki numara yanlış kalır.
 */
let nextChitId: bigint | null = null;
let idQueue: Promise<unknown> = Promise.resolve();

function resyncChitId(): void {
  nextChitId = null;
}

async function reserveChitId(
  readTotalMinted: () => Promise<bigint>
): Promise<bigint> {
  const task = idQueue.then(async () => {
    if (nextChitId === null) {
      nextChitId = await readTotalMinted();
    }
    const id = nextChitId;
    nextChitId = id + 1n;
    return id;
  });

  // Bir ayırma hata verse bile sıra kilitlenmemeli.
  idQueue = task.then(
    () => undefined,
    () => undefined
  );
  return task;
}

/** Basım işleminin loglarından bilet kimliğini çıkarır. */
function tokenIdFromLogs(logs: readonly unknown[]): string | null {
  for (const entry of logs) {
    // viem'in Base makbuz tipinde `topics` jenerik daralması yüzünden düşüyor;
    // çalışma zamanında alan her zaman var. Assertion yalnızca bu sınırda.
    const log = entry as { data: Hex; topics: [Hex, ...Hex[]] };
    try {
      const decoded = decodeEventLog({
        abi: TOLLCHIT_ABI,
        eventName: "ChitMinted",
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
 * Gönderilmiş bir basımın sonucunu arka planda doğrular ve günlüğe yazar.
 *
 * Yanıt bunu beklemiyor; amacı, bir şey ters gittiğinde loglarda iz bırakmak.
 */
async function confirmMint(
  waitForReceipt: () => Promise<{ status: string; logs: readonly unknown[] }>,
  txHash: `0x${string}`,
  reservedId: bigint
): Promise<void> {
  try {
    const receipt = await waitForReceipt();

    if (receipt.status !== "success") {
      // Numara ayrıldı ama kullanılmadı; sayaç zincirden yeniden okunmalı.
      resyncChitId();
      console.warn(`[receipt] Basım işlemi revert etti: ${txHash}`);
      return;
    }

    const tokenId = tokenIdFromLogs(receipt.logs);
    if (!tokenId) {
      console.warn(`[receipt] ChitMinted olayı okunamadı: ${txHash}`);
      return;
    }

    // Ayrılan numara tutmadıysa sayaç kaymış demektir (aynı cüzdanla basan
    // ikinci bir süreç). Kontratta setTokenURI olmadığı için o biletin
    // görselindeki numara düzeltilemez; yapılabilecek tek şey sayacı zincirden
    // yeniden okumak ki sonraki biletler doğru olsun.
    if (tokenId !== reservedId.toString()) {
      console.error(
        `[receipt] Seri numarası kaydı: ayrılan #${reservedId}, verilen #${tokenId}. ` +
          "Bu biletin görselindeki numara yanlış; sayaç zincirden yeniden okunacak."
      );
      resyncChitId();
      return;
    }

    console.log(`[receipt] Bilet #${tokenId} onaylandı (${txHash})`);
  } catch (err) {
    console.error(`[receipt] Basım onayı okunamadı (${txHash}):`, err);
  }
}

/**
 * Ödemeyi yapana bir TollChit402 bileti basar.
 *
 * @returns Basılan bilet, ya da basım yapılamadıysa `null`. Bu fonksiyon
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
    // kontrat veriyor. Bu yüzden numara önce ayrılıyor; basımdan sonra da
    // gerçekten o numaranın verildiği doğrulanıyor (aşağıda).
    const reservedId = await reserveChitId(
      async () =>
        (await publicClient.readContract({
          address: config.contract,
          abi: TOLLCHIT_ABI,
          functionName: "totalMinted",
          // `authorizationList: undefined` yalnızca tip düzeyinde gerekiyor:
          // strictNullChecks kapalı olduğu için viem'in koşullu tipi bu isteğe
          // bağlı alanı zorunlu sayıyor (deploy.ts'teki kzg notuyla aynı sebep).
          authorizationList: undefined,
        })) as bigint
    );
    const uri = buildTokenUri(params, mintedAt, reservedId);

    // Göndermeden ÖNCE simüle et. İki kazancı var:
    //   - Kontrat çağrıyı reddedecekse (onlyOwner, yanlış adres, ABI uyumsuz)
    //     sebebi burada okunabilir bir hata olarak öğreniliyor; aksi hâlde
    //     gaz harcanıp zincirde revert eden bir işlemle öğrenilirdi.
    //   - Boşa gaz harcanmıyor.
    await publicClient.simulateContract({
      address: config.contract,
      abi: TOLLCHIT_ABI,
      functionName: "mint",
      args: [params.to as `0x${string}`, uri],
      account,
      authorizationList: undefined,
    });

    const txHash = await walletClient.writeContract({
      address: config.contract,
      abi: TOLLCHIT_ABI,
      functionName: "mint",
      args: [params.to as `0x${string}`, uri],
      account,
      chain: base,
      // Kontrat çağrısı normal bir EIP-1559 işlemi. `kzg: undefined` yalnızca
      // tip düzeyinde gerekiyor (bkz. contracts/scripts/deploy.ts'teki not).
      type: "eip1559",
      kzg: undefined,
    });

    // Blok onayı BEKLENMİYOR. Sebep: bu fonksiyon ödemenin yanıtını bekleten
    // yolun içinde. Base'de blok ~2 sn ve bunun üstüne 5 RPC turu biniyor;
    // onayı beklemek bütçeyi düzenli olarak aşıyor ve bilet yanıta hiç
    // yetişmiyordu. Üstelik serverless ortamda yanıt gittikten sonra süreç
    // donduruluyor, yani "arka planda tamamlanır" varsayımı da tutmuyor.
    //
    // Bilet kimliği zaten ayrıldı ve simülasyon çağrının geçerli olduğunu
    // kanıtladı, dolayısıyla gönderim yeterli. Onay arka planda doğrulanıp
    // günlüğe yazılıyor.
    console.log(`[receipt] Bilet #${reservedId} gönderildi → ${params.to} (${txHash})`);
    void confirmMint(
      () =>
        publicClient.waitForTransactionReceipt({
          hash: txHash,
          timeout: MINT_DEADLINE_MS,
        }),
      txHash,
      reservedId
    );

    return { tokenId: reservedId.toString(), txHash };
  } catch (err) {
    // Gaz bitmiş, RPC düşmüş, alıcı ERC-721 kabul etmeyen bir kontrat olabilir.
    // Hiçbiri ödemeyi ilgilendirmez: ödeme çoktan zincire yazıldı.
    //
    // Sayaç sıfırlanıyor: numara ayrıldı ama bilet basılmadıysa, sıfırlamadan
    // sonraki her bilet bir numara ileriden başlardı.
    resyncChitId();
    console.error("[receipt] Bilet basılamadı:", err);
    return null;
  }
}
