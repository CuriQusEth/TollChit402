/**
 * Ödeme sayacı.
 *
 * Kalıcı bir veritabanı yok. Vercel KV yapılandırılmışsa sayaçlar orada tutulur
 * ve dağıtımlar arasında yaşar; yapılandırılmamışsa (yerel geliştirme, KV'siz
 * dağıtım) süreç belleğine düşülür — bu durumda sayaçlar her yeniden başlatmada
 * ve her yeni dağıtımda sıfırlanır, ayrıca serverless örnekleri arasında
 * paylaşılmaz.
 */

// Marka TollChit402 olarak değişti ama bu anahtarlar bilinçli olarak eski
// adlarında bırakıldı: değiştirmek KV'de birikmiş sayaçları sıfırdan başlatırdı.
const PAYMENTS_KEY = "x402-pay:stats:payments";
const VOLUME_KEY = "x402-pay:stats:volume-atomic";

/** USDC 6 haneli; atomik birimden dolara çevirmek için. */
const USDC_DECIMALS = 6;

export type Stats = {
  totalPayments: number;
  totalVolumeUsd: string;
  /** Sayaçların kalıcı mı yoksa süreç ömürlü mü olduğunu açıkça bildirir. */
  persistent: boolean;
};

let memoryPayments = 0;
let memoryVolumeAtomic = 0;

/** KV yalnızca kendi ortam değişkenleri varsa kullanılabilir. */
function kvConfigured(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

/**
 * KV istemcisini yalnızca gerçekten yapılandırıldığında yükler.
 *
 * Dinamik import bilinçli: KV kullanılmayan bir dağıtımda paketin hiç
 * çalıştırılmaması gerekiyor.
 */
async function kvClient() {
  const { kv } = await import("@vercel/kv");
  return kv;
}

function toUsd(atomic: number): string {
  return (atomic / 10 ** USDC_DECIMALS).toFixed(2);
}

/**
 * Bir settlement'ı sayar.
 *
 * Sayaç asla ödeme akışını bozmamalı: KV'ye yazılamazsa hata yutulur, çünkü
 * ödeme çoktan zincire yazılmıştır ve istemciye 500 dönmek yanlış olur.
 */
export async function recordPayment(amountAtomic: number): Promise<void> {
  if (!Number.isFinite(amountAtomic) || amountAtomic < 0) return;

  if (kvConfigured()) {
    try {
      const kv = await kvClient();
      await Promise.all([
        kv.incr(PAYMENTS_KEY),
        kv.incrby(VOLUME_KEY, amountAtomic),
      ]);
      return;
    } catch (err) {
      console.error("[stats] KV'ye yazılamadı, bellek sayacına düşülüyor:", err);
    }
  }

  memoryPayments += 1;
  memoryVolumeAtomic += amountAtomic;
}

/** Güncel sayaçları okur. */
export async function readStats(): Promise<Stats> {
  if (kvConfigured()) {
    try {
      const kv = await kvClient();
      const [payments, volume] = await Promise.all([
        kv.get<number>(PAYMENTS_KEY),
        kv.get<number>(VOLUME_KEY),
      ]);
      return {
        totalPayments: Number(payments ?? 0),
        totalVolumeUsd: toUsd(Number(volume ?? 0)),
        persistent: true,
      };
    } catch (err) {
      console.error("[stats] KV okunamadı, bellek sayacı raporlanıyor:", err);
    }
  }

  return {
    totalPayments: memoryPayments,
    totalVolumeUsd: toUsd(memoryVolumeAtomic),
    persistent: false,
  };
}
