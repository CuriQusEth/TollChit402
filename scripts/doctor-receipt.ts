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
 *   npm run doctor:receipt
 */
import { config } from "dotenv";
import { diagnoseReceiptMinting } from "../api/_receipt-doctor.js";

config();

async function main() {
  console.log("\nTollChit402 bilet basımı teşhisi\n");

  const { ok, checks } = await diagnoseReceiptMinting();

  for (const check of checks) {
    console.log(`  ${check.ok ? "✓" : "✗"} ${check.name} — ${check.detail}`);
    if (check.fix) console.log(`      → ${check.fix}`);
  }

  console.log(
    ok
      ? "\nSonuç: her şey yolunda. Basım çalışmalı; çalışmıyorsa sunucu loglarındaki [receipt] satırlarına bakın.\n"
      : "\nSonuç: en az bir kontrol başarısız — yukarıdaki → satırlarını izleyin.\n"
  );
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("\nTeşhis çalıştırılamadı:", err);
  process.exit(1);
});
