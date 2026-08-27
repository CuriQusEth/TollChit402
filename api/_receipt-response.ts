/**
 * Makbuz sonucunu settlement kancasından yanıt gövdesine taşır.
 *
 * Sorun şu: makbuz ancak settlement tamamlandıktan sonra basılabilir, ama
 * settlement handler ÇALIŞTIKTAN sonra olur — yani `res.json(...)` çoktan
 * çağrılmıştır. @x402/express bu arada yanıtı tamponlar ve settlement bittikten
 * sonra tamponu olduğu gibi tele yazar, dolayısıyla kancanın gövdeye
 * dokunabileceği bir yer yoktur.
 *
 * Buradaki iki parça o boşluğu kapatıyor:
 *
 *   1. İstek başına bir "yuva" (slot), AsyncLocalStorage ile taşınıyor. Ödeme
 *      hattının tamamı bu bağlam içinde çalıştığı için kanca, hangi isteğe ait
 *      olduğunu bilmek için kütüphane iç yapılarına uzanmak zorunda kalmıyor ve
 *      eşzamanlı istekler birbirine karışmıyor.
 *   2. `res.end`, ödeme katmanı devreye girmeden ÖNCE sarmalanıyor. Böylece
 *      adaptörün yakaladığı "orijinal" end aslında bizim sarmalayıcımız oluyor
 *      ve tampon tele yazılırken — yani settlement bittikten sonra — gövdeye
 *      makbuz alanını ekleyebiliyoruz.
 *
 * Mevcut alanlara dokunulmuyor: gövde yalnızca `receipt` anahtarıyla genişler.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Response } from "express";
import type { ReceiptMint } from "./_receipt.js";

/** Yanıt gövdesine eklenen makbuz kaydı. */
export type ReceiptField = (ReceiptMint & { contract: string }) | null;

type ReceiptSlot = {
  /** Ödemenin yapıldığı paket; kanca bunu başka yerden öğrenemez. */
  tierId: string;
  /**
   * Kancanın yazdığı sonuç. `undefined` = kanca hiç çalışmadı (ödeme
   * tamamlanmadı), `null` = basım denendi ama olmadı.
   */
  receipt?: ReceiptField;
};

const storage = new AsyncLocalStorage<ReceiptSlot>();

/** Kancanın içinden bu isteğin yuvasını verir. */
export function currentReceiptSlot(): ReceiptSlot | undefined {
  return storage.getStore();
}

function toBuffer(chunk: unknown, encoding?: unknown): Buffer | null {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === "string") {
    return Buffer.from(chunk, (encoding as BufferEncoding) || "utf8");
  }
  return null;
}

/**
 * Tamponlanmış JSON gövdesine makbuz alanını ekler.
 *
 * @returns Yeni gövde, ya da gövde JSON nesnesi değilse `null` (dokunulmaz).
 */
function mergeReceipt(body: Buffer, receipt: ReceiptField): Buffer | null {
  try {
    const parsed: unknown = JSON.parse(body.toString("utf8"));
    // Dizi ya da skaler bir gövdeye alan eklenemez; öyle bir uç yok ama
    // varsayım yapmak yerine dokunmadan geçmek doğrusu.
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return Buffer.from(JSON.stringify({ ...parsed, receipt }), "utf8");
  } catch {
    return null;
  }
}

/**
 * İsteği bir makbuz yuvası bağlamında çalıştırır ve yanıt gövdesini sarmalar.
 *
 * @param tierId Ödemenin yapıldığı paket.
 * @param res    Express yanıtı.
 * @param run    Ödeme katmanını çalıştıran fonksiyon.
 */
export function withReceiptSlot<T>(tierId: string, res: Response, run: () => T): T {
  const slot: ReceiptSlot = { tierId };

  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);

  const chunks: Buffer[] = [];
  let buffering = true;

  /**
   * Node'un `(chunk?, encoding?, callback?)` imzasını ayrıştırır.
   *
   * Üç biçim de geçerli: `end(cb)`, `end(chunk, cb)`, `end(chunk, enc, cb)`.
   * Geri çağrı düşürülürse yanıtı bekleyen taraf sonsuza kadar bekler.
   */
  function splitArgs(a?: unknown, b?: unknown, c?: unknown) {
    if (typeof a === "function") return { body: null, callback: a as () => void };
    if (typeof b === "function") {
      return { body: toBuffer(a), callback: b as () => void };
    }
    return {
      body: toBuffer(a, b),
      callback: typeof c === "function" ? (c as () => void) : undefined,
    };
  }

  // Gövde parça parça yazılabilir; hepsi toplanıp `end` anında birleştirilir.
  res.write = function (a?: unknown, b?: unknown, c?: unknown): boolean {
    if (buffering) {
      const { body, callback } = splitArgs(a, b, c);
      if (body) {
        chunks.push(body);
        // Yazma gerçekte ertelendi; geri çağrı yine de sözleşme gereği çağrılır.
        if (callback) process.nextTick(callback);
        return true;
      }
    }
    return (originalWrite as (...args: unknown[]) => boolean)(a, b, c);
  } as typeof res.write;

  res.end = function (a?: unknown, b?: unknown, c?: unknown): Response {
    const end = originalEnd as (...args: unknown[]) => Response;
    if (!buffering) return end(a, b, c);
    buffering = false;

    const { body, callback } = splitArgs(a, b, c);
    if (body) chunks.push(body);

    const collected = Buffer.concat(chunks);
    // `undefined` = kanca hiç çalışmadı (ödeme tamamlanmamış bir yanıt);
    // o zaman gövdeye dokunulmaz.
    const merged =
      slot.receipt === undefined || collected.length === 0
        ? null
        : mergeReceipt(collected, slot.receipt);

    if (merged && !res.headersSent) {
      // Gövde uzunluğu değişti; Content-Length güncellenmezse istemci yanıtı
      // yarıda kesilmiş sanar.
      res.setHeader("Content-Length", String(merged.length));
    }

    const payload = merged ?? collected;
    if (payload.length === 0) return callback ? end(callback) : end();
    return callback ? end(payload, callback) : end(payload);
  } as typeof res.end;

  return storage.run(slot, run);
}
