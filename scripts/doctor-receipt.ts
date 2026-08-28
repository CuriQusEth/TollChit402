/**
 * Bilet basımı teşhis aracı (yerel).
 *
 * Kontrollerin tamamı api/_receipt-doctor.ts'te; burası yalnızca onları
 * çalıştırıp okunur biçimde yazdırıyor. Aynı kontroller dağıtılmış ortamda
 * `GET /api/receipt-status` ile de alınabilir.
 *
 * Gerçek bir ödeme GEREKTİRMEZ.
 *
 * Kullanım:
 *   npm run doctor:receipt        (İngilizce)
 *   npm run doctor:receipt -- tr  (Türkçe)
 */
import { config } from "dotenv";
import { diagnoseReceiptMinting } from "../api/_receipt-doctor.js";
import { msg, readLang } from "../api/_messages.js";

config();

async function main() {
  const lang = readLang(process.argv.slice(2).find((arg) => arg === "tr"));

  console.log(`\n${msg(lang, "docTitle")}\n`);

  const { ok, checks } = await diagnoseReceiptMinting(lang);

  for (const check of checks) {
    console.log(`  ${check.ok ? "✓" : "✗"} ${check.name} — ${check.detail}`);
    if (check.fix) console.log(`      → ${check.fix}`);
  }

  console.log(`\n${ok ? msg(lang, "docAllOk") : msg(lang, "docSummaryFail")}\n`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("\n[doctor] Teşhis çalıştırılamadı:", err);
  process.exit(1);
});
