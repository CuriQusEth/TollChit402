/**
 * Ödeme geçmişinin tarayıcıda saklanması.
 *
 * Kayıtlar yalnızca bu tarayıcıda durur; sunucu tarafında bir kayıt tutulmaz.
 * Gizli pencere, temizlenmiş site verisi ya da site verisini engelleyen bir
 * tarayıcı ayarında okuma/yazma hata fırlatabildiği için her erişim korunuyor.
 */

// Marka TollChit402 olarak değişti ama bu anahtar bilinçli olarak eski adında
// bırakıldı: değiştirmek, kullanıcıların tarayıcısında duran geçmişi bir anda
// erişilemez kılardı. Yeniden adlandırma ancak bir taşıma adımıyla anlamlı olur.
const STORAGE_KEY = "x402-pay:history";
const MAX_RECORDS = 20;

export type PaymentRecord = {
  txHash: string;
  amount: string;
  recipient: string;
  timestamp: string;
  network: string;
};

function isRecord(value: unknown): value is PaymentRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.txHash === "string" &&
    typeof r.amount === "string" &&
    typeof r.recipient === "string" &&
    typeof r.timestamp === "string" &&
    typeof r.network === "string"
  );
}

/** Saklanan kayıtları okur; okunamaz ya da bozuksa boş liste döner. */
export function loadHistory(): PaymentRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    // Elle düzenlenmiş ya da eski biçimde kalmış girdiler tüm paneli
    // bozmasın diye tek tek eleniyor.
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    return [];
  }
}

/** Yeni kaydı başa ekler, listeyi son {@link MAX_RECORDS} girdiyle sınırlar. */
export function appendRecord(record: PaymentRecord): PaymentRecord[] {
  const next = [record, ...loadHistory()].slice(0, MAX_RECORDS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Yazılamazsa geçmiş kalıcı olmaz; ödeme yine de tamamlanmıştır.
  }
  return next;
}

/** Geçmişi tamamen siler. */
export function clearHistory(): PaymentRecord[] {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Silinemezse bir sonraki okumada eski kayıtlar dönebilir.
  }
  return [];
}

/** "3 dk önce" gibi kısa bir görece zaman metni üretir. */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "-";

  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "az önce";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} dk önce`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} sa önce`;

  return `${Math.floor(hours / 24)} gün önce`;
}

/** Adresi 0x1234…abcd biçiminde kısaltır. */
export function shortAddress(address: string): string {
  return address.length > 10
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address;
}
