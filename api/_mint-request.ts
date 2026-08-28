/**
 * Kullanıcının isteğiyle bilet basımı.
 *
 * Otomatik basım ödeme sonrasında zaten çalışıyor (api/_premium.ts'teki
 * onAfterSettle kancası). Bu modül ikinci bir yol açıyor: arayüzdeki geçmiş
 * panelinden "Makbuzu NFT olarak bastır" düğmesi. Geçmiş bir ödeme için ya da
 * otomatik basımın yetişemediği bir durum için işe yarıyor.
 *
 * GÜVENLİK — BURASI ÖNEMLİ.
 * Basımın gazını proje ödüyor. Korumasız bir uç, herkesin sınırsız bedava NFT
 * bastırıp bu cüzdanı kurutmasına açık olurdu. Bu yüzden iki şey birlikte
 * doğrulanıyor:
 *
 *   1. İSTEYEN, ÖDEYEN Mİ? İstemci, ödemenin işlem hash'ini içeren bir mesajı
 *      cüzdanıyla imzalıyor (gazsız, sadece imza). Sunucu imzadan adresi
 *      kurtarıyor.
 *   2. ÖDEME GERÇEK Mİ? O işlem zincirden okunuyor, başarılı olduğu ve içinde
 *      gerçek bir USDC transferi bulunduğu doğrulanıyor — ve transferi YAPAN
 *      adresin imzayı atan adresle aynı olduğu.
 *
 * Yani bilet yalnızca gerçekten ödeme yapmış cüzdana, kendi talebiyle
 * basılabiliyor. Bir işlem hash'i en fazla bir kez kullanılabiliyor.
 */
import {
  createPublicClient,
  decodeEventLog,
  formatUnits,
  http,
  recoverMessageAddress,
  type Address,
  type Hex,
} from "viem";
import { base } from "viem/chains";
import { mintReceipt, type ReceiptMint } from "./_receipt.js";

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const SIGNATURE = /^0x[0-9a-fA-F]+$/;

/** Base mainnet üzerindeki resmî USDC kontratı. */
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/** USDC 6 haneli. */
const USDC_DECIMALS = 6;

/** Yalnızca ERC-20 Transfer olayı çözülüyor. */
const TRANSFER_ABI = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

/**
 * İstemcinin imzalayacağı mesaj.
 *
 * İşlem hash'ini içeriyor: böylece bir imza yalnızca tek bir ödeme için
 * geçerli oluyor ve başka bir talebe yeniden kullanılamıyor.
 */
export function mintRequestMessage(txHash: string): string {
  return [
    "TollChit402 makbuz talebi",
    "",
    `İşlem: ${txHash}`,
    "",
    "Bu imza yalnızca ödemenin size ait olduğunu kanıtlar.",
    "Cüzdanınızdan para çıkmaz ve gaz ödemezsiniz.",
  ].join("\n");
}

/**
 * Kullanılmış işlem hash'leri.
 *
 * Aynı ödeme için ikinci bir bilet basılmasını engelliyor. Süreç belleğinde:
 * serverless örnekleri arasında paylaşılmıyor, yani nadiren yinelenen bir
 * bilet basılabilir. Bu bir güvenlik açığı değil (bilet yine yalnızca gerçek
 * ödeyene gidiyor), sadece küçük bir gaz israfı; kalıcı bir engel için
 * paylaşımlı bir depo (KV) gerekirdi.
 */
const usedTxHashes = new Set<string>();

/**
 * Sonuç.
 *
 * Ayırıcı olarak boolean yerine alan varlığı kullanılıyor: projede
 * strictNullChecks kapalı olduğu için `ok: true | false` ile daraltma
 * çalışmıyor (bkz. pickPaymentRecipient'taki aynı kalıp).
 */
export type MintRequestResult =
  | { receipt: ReceiptMint & { contract: string } }
  | { status: number; error: string; message: string };

type Deps = {
  /** Bilet kontratının adresi; yapılandırılmamışsa null. */
  contract: string | null;
};

type UsdcTransfer = { from: Address; to: Address; amountUsd: string };

/**
 * İşlemdeki TÜM USDC transferlerini çözer.
 *
 * Yalnızca ilkine bakmak yetmiyor: bir settlement işlemi birden fazla USDC
 * transferi taşıyabiliyor (örneğin bir ücret transferi) ve ödeyenin transferi
 * ilk sırada olmayabiliyor. İlkini "ödeyen" saymak, gerçekten ödeme yapmış
 * kullanıcının talebini reddediyordu.
 */
function usdcTransfers(logs: readonly unknown[]): UsdcTransfer[] {
  const found: UsdcTransfer[] = [];

  for (const entry of logs) {
    // viem'in Base makbuz tipinde `topics` jenerik daralması yüzünden düşüyor;
    // çalışma zamanında alan her zaman var.
    const log = entry as { address: string; data: Hex; topics: [Hex, ...Hex[]] };
    if (log.address.toLowerCase() !== USDC_BASE.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: TRANSFER_ABI,
        eventName: "Transfer",
        data: log.data,
        topics: log.topics,
      });
      found.push({
        from: decoded.args.from,
        to: decoded.args.to,
        amountUsd: formatUnits(decoded.args.value, USDC_DECIMALS),
      });
    } catch {
      // Transfer olmayan loglar atlanır.
    }
  }

  return found;
}

/**
 * İmzalı bir bilet talebini doğrular ve basar.
 *
 * @param txHash    Ödemenin settlement işlemi.
 * @param signature İstemcinin {@link mintRequestMessage} üzerine attığı imza.
 * @param tierId    Bilete yazılacak paket adı (yalnızca metadata için).
 */
export async function handleMintRequest(
  { txHash, signature, tierId }: { txHash: string; signature: string; tierId: string },
  deps: Deps
): Promise<MintRequestResult> {
  if (!deps.contract) {
    return {
      status: 503,
      error: "minting_disabled",
      message:
        "Bilet basımı bu dağıtımda yapılandırılmamış. Ayrıntı için /api/receipt-status.",
    };
  }

  if (!TX_HASH.test(txHash)) {
    return {
      status: 400,
      error: "invalid_hash",
      message: "Geçersiz işlem hash'i: 0x ile başlayan 64 haneli olmalı.",
    };
  }

  if (!SIGNATURE.test(signature)) {
    return {
      status: 400,
      error: "invalid_signature",
      message: "Geçersiz imza biçimi.",
    };
  }

  if (usedTxHashes.has(txHash.toLowerCase())) {
    return {
      status: 409,
      error: "already_minted",
      message: "Bu ödeme için zaten bir bilet basılmış.",
    };
  }

  const client = createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL || undefined),
  });

  // --- 1. Ödeme gerçek mi? ---
  let transfers: UsdcTransfer[] = [];
  try {
    const receipt = await client.getTransactionReceipt({ hash: txHash as Hex });
    if (receipt.status !== "success") {
      return {
        status: 400,
        error: "tx_failed",
        message: "Bu işlem zincirde başarısız olmuş; bilet basılamaz.",
      };
    }
    transfers = usdcTransfers(receipt.logs);
  } catch {
    return {
      status: 404,
      error: "tx_not_found",
      message:
        "Bu hash ile bir işlem bulunamadı. Base ağında ve onaylanmış olduğundan emin olun.",
    };
  }

  if (transfers.length === 0) {
    return {
      status: 400,
      error: "not_a_payment",
      message: "Bu işlemde USDC transferi yok; bir x402 ödemesi değil.",
    };
  }

  // --- 2. İsteyen, ödeyen mi? ---
  // İşlemdeki transferlerin HERHANGİ birinin göndereni imzayı atmışsa geçerli.
  const message = mintRequestMessage(txHash);

  // client.verifyMessage kullanılıyor (bağımsız verifyMessage değil): bu, EOA
  // imzalarının yanında akıllı kontrat cüzdanlarının ERC-1271/6492 imzalarını
  // da zincirde doğruluyor. Bağımsız sürüm yalnızca ECDSA bakıyor ve akıllı
  // cüzdanla ödeyen bir kullanıcıyı haksız yere reddediyordu.
  let payer: UsdcTransfer | null = null;
  for (const candidate of transfers) {
    const valid = await client
      .verifyMessage({
        address: candidate.from,
        message,
        signature: signature as Hex,
      })
      .catch(() => false);
    if (valid) {
      payer = candidate;
      break;
    }
  }

  if (!payer) {
    // Sebebi görünür kılmak için imzadan çözülen adres de bildiriliyor; bunsuz
    // hata mesajı çıkmaz sokaktı. (Akıllı cüzdanlarda bu adres anlamsız olur.)
    let signer = "çözülemedi";
    try {
      signer = await recoverMessageAddress({ message, signature: signature as Hex });
    } catch {
      // ECDSA ile çözülemedi; akıllı kontrat imzası olabilir.
    }

    return {
      status: 403,
      error: "not_the_payer",
      message:
        "İmza, bu ödemeyi yapan cüzdana ait değil. " +
        `İmzalayan: ${signer}. Bu işlemde USDC gönderen adres(ler): ` +
        `${transfers.map((t) => t.from).join(", ")}. ` +
        "Bilet talebini, ödemeyi yapan cüzdanla bağlanarak yapın.",
    };
  }

  // --- 3. Bas ---
  // Hash, basımdan ÖNCE işaretleniyor: eşzamanlı iki tıklama iki bilet
  // basmasın. Basım başarısız olursa işaret geri alınıyor.
  usedTxHashes.add(txHash.toLowerCase());

  const minted = await mintReceipt({
    to: payer.from,
    tierId,
    amountUsd: payer.amountUsd,
    network: "eip155:8453",
  });

  if (!minted) {
    usedTxHashes.delete(txHash.toLowerCase());
    return {
      status: 502,
      error: "mint_failed",
      message:
        "Bilet basılamadı. Sebebi için /api/receipt-status sayfasına bakın; " +
        "ödemeniz bundan etkilenmez.",
    };
  }

  return { receipt: { ...minted, contract: deps.contract } };
}
