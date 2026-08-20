#!/usr/bin/env node
/**
 * Validates a deployed x402 endpoint against CDP's validator.
 *
 * POST /v2/x402/validate probes the URL live and reports the preflight checks
 * (reachable, returns_402, has_bazaar_extension, parse) plus the accept/reject
 * decision the facilitator would make. It is read-only: no payment is made and
 * the resource is not indexed. The endpoint is unauthenticated, so no CDP
 * credentials are needed to run this.
 *
 * Usage: npm run validate -- https://your-deployment/api/premium
 */

const VALIDATE_URL = "https://api.cdp.coinbase.com/platform/v2/x402/validate";

const resource = process.argv[2];

if (!resource) {
  console.error(
    "Kullanım: npm run validate -- https://<alan-adiniz>/api/premium\n" +
      "Endpoint herkese açık HTTPS üzerinden erişilebilir olmalı; localhost doğrulanamaz."
  );
  process.exit(1);
}

if (!resource.startsWith("https://")) {
  console.error(`Geçersiz URL: ${resource}\nCDP doğrulayıcısı yalnızca https:// kabul eder.`);
  process.exit(1);
}

const response = await fetch(VALIDATE_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ resource, method: "GET" }),
});

if (!response.ok) {
  console.error(`Doğrulayıcı ${response.status} döndü:\n${await response.text()}`);
  process.exit(1);
}

const result = await response.json();

console.log(`\nEndpoint : ${resource}`);
console.log(`Durum    : HTTP ${result.statusCode ?? "-"}  (x402 v${result.x402Version ?? "?"})\n`);

for (const { check, passed, detail } of result.preflight ?? []) {
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${check}${detail ? ` — ${detail}` : ""}`);
}

if (result.paymentRequirements) {
  console.log("\nÖdeme şartları:");
  console.log(JSON.stringify(result.paymentRequirements, null, 2));
}

console.log(`\n${result.valid ? "GEÇERLİ: endpoint indekslenmeye hazır." : "GEÇERSİZ: yukarıdaki başarısız kontrolleri giderin."}`);
process.exit(result.valid ? 0 : 1);
