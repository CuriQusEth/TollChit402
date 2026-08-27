/**
 * Bilet basımı teşhisi.
 *
 * Basım yolu bilinçli olarak sessiz: her hata yutulup `null` dönüyor ki bir
 * basım sorunu asla tamamlanmış bir ödemeyi bozmasın. İyi bir tasarım, ama
 * sorunun sebebini yalnızca sunucu loglarında bırakıyor — dağıtılmış bir
 * ortamda oraya bakmak çoğu zaman zor.
 *
 * Buradaki kontroller o boşluğu kapatıyor: gerçek bir ödeme GEREKTİRMEDEN
 * yapılandırmayı okuyor, zinciri sorguluyor ve `mint` çağrısını simüle
 * ediyorlar. Simülasyon gaz harcamaz ama kontratın gerçekte ne diyeceğini
 * (örneğin OwnableUnauthorizedAccount) aynen gösterir.
 *
 * Aynı modül iki yerden kullanılıyor: `npm run doctor:receipt` (yerel) ve
 * `GET /api/receipt-status` (dağıtılmış ortam).
 */
import { createPublicClient, formatEther, http, type Address } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readContractAddress } from "./_receipt.js";

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;

/** Base mainnet. Kontrat başka bir ağdaysa basım hiç çalışmaz. */
const BASE_CHAIN_ID = 8453;

/** Kontratın beklenen sembolü; yanlış adresi yakalar. */
const EXPECTED_SYMBOL = "CHIT402";

/**
 * Teşhis için gereken ABI parçası.
 *
 * OZ 5.x'in custom error'ı da burada: olmazsa viem, onlyOwner reddini
 * okunabilir bir ad yerine ham selector (0x118cdaa7) olarak gösterir.
 */
const ABI = [
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
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "error",
    name: "OwnableUnauthorizedAccount",
    inputs: [{ name: "account", type: "address" }],
  },
] as const;

export type Check = {
  /** Kontrolün kısa adı. */
  name: string;
  ok: boolean;
  /** Bulunan değer ya da hata metni. */
  detail: string;
  /** Başarısızsa ne yapılacağı. */
  fix?: string;
};

export type Diagnosis = {
  ok: boolean;
  checks: Check[];
};

function errorText(err: unknown): string {
  const message = (err as Error)?.message ?? String(err);
  // Simülasyon hataları çok satırlı ve asıl sebep genelde sonlarda; kırpmıyoruz.
  return message.trim();
}

/**
 * Basım yapılandırmasını ve zincir durumunu baştan sona kontrol eder.
 *
 * Hiçbir gizli bilgi döndürmez: yalnızca herkese açık adresler, bakiye ve
 * kontrat okumaları. Private key hiçbir çıktıya girmez.
 */
export async function diagnoseReceiptMinting(): Promise<Diagnosis> {
  const checks: Check[] = [];
  const add = (check: Check) => checks.push(check);
  const done = (): Diagnosis => ({ ok: checks.every((c) => c.ok), checks });

  // --- 1. Yapılandırma ---
  const { value: contract, source } = readContractAddress();
  const key = process.env.RECEIPT_MINTER_PRIVATE_KEY?.trim();

  const contractOk = Boolean(contract) && EVM_ADDRESS.test(contract as string);
  add({
    name: "Kontrat adresi",
    ok: contractOk,
    detail: contract
      ? contractOk
        ? `${contract}  (${source})`
        : `geçersiz: "${contract}"  (${source})`
      : "TOLLCHIT_CONTRACT_ADDRESS tanımlı değil (eski adı RECEIPT_CONTRACT_ADDRESS da okunur)",
    fix: contractOk
      ? source === "RECEIPT_CONTRACT_ADDRESS"
        ? "Çalışıyor ama değişken eski adıyla duruyor; TOLLCHIT_CONTRACT_ADDRESS olarak yeniden adlandırın."
        : undefined
      : "Basım kapalı. Dağıtılmış TollChit402 adresini ortam değişkenlerine ekleyin " +
        "(Vercel'de Settings > Environment Variables, ardından yeniden dağıtım).",
  });

  const keyOk = Boolean(key) && PRIVATE_KEY.test(key as string);
  add({
    name: "RECEIPT_MINTER_PRIVATE_KEY",
    ok: keyOk,
    detail: key ? (keyOk ? "tanımlı ve biçimi geçerli" : "geçersiz biçim") : "tanımlı değil",
    fix: keyOk
      ? undefined
      : "Kontratın sahibi olan cüzdanın private key'i olmalı: 0x + 64 hane.",
  });

  add({
    name: "BASE_RPC_URL",
    ok: true,
    detail: process.env.BASE_RPC_URL?.trim() || "(tanımsız — public RPC kullanılıyor)",
  });

  if (!contractOk || !keyOk) return done();

  const minter = privateKeyToAccount(key as `0x${string}`);
  const address = contract as Address;
  const client = createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL?.trim() || undefined),
  });

  add({ name: "Basım cüzdanı", ok: true, detail: minter.address });

  // --- 2. Ağ ve kontrat ---
  try {
    const chainId = await client.getChainId();
    add({
      name: "RPC ağı",
      ok: chainId === BASE_CHAIN_ID,
      detail: `chain ${chainId}`,
      fix:
        chainId === BASE_CHAIN_ID
          ? undefined
          : `Base mainnet (${BASE_CHAIN_ID}) bekleniyordu. BASE_RPC_URL yanlış ağa bakıyor.`,
    });
  } catch (err) {
    add({
      name: "RPC erişimi",
      ok: false,
      detail: errorText(err),
      fix: "RPC adresine ulaşılamıyor. BASE_RPC_URL doğru ve erişilebilir mi?",
    });
    return done();
  }

  try {
    const code = await client.getCode({ address });
    const hasCode = Boolean(code) && code !== "0x";
    add({
      name: "Kontrat bytecode",
      ok: hasCode,
      detail: hasCode ? `${((code as string).length - 2) / 2} bayt` : "bu adreste kontrat YOK",
      fix: hasCode
        ? undefined
        : "Adres yanlış ya da kontrat başka bir ağa (örn. Base Sepolia) dağıtılmış. " +
          `Kontrol: https://basescan.org/address/${address}`,
    });
    if (!hasCode) return done();
  } catch (err) {
    add({ name: "Kontrat bytecode", ok: false, detail: errorText(err) });
    return done();
  }

  // --- 3. ABI uyumu ---
  try {
    const minted = (await client.readContract({
      address,
      abi: ABI,
      functionName: "totalMinted",
      authorizationList: undefined,
    })) as bigint;
    add({ name: "totalMinted()", ok: true, detail: `${minted} bilet basılmış` });
  } catch (err) {
    add({
      name: "totalMinted()",
      ok: false,
      detail: errorText(err),
      fix: "Bu adresteki kontrat TollChit402 değil ya da ABI eşleşmiyor.",
    });
  }

  try {
    const symbol = (await client.readContract({
      address,
      abi: ABI,
      functionName: "symbol",
      authorizationList: undefined,
    })) as string;
    add({
      name: "symbol()",
      ok: symbol === EXPECTED_SYMBOL,
      detail: symbol,
      fix: symbol === EXPECTED_SYMBOL ? undefined : `${EXPECTED_SYMBOL} bekleniyordu; yanlış kontrat olabilir.`,
    });
  } catch (err) {
    add({ name: "symbol()", ok: false, detail: errorText(err) });
  }

  // --- 4. Sahiplik ve bakiye ---
  try {
    const owner = (await client.readContract({
      address,
      abi: ABI,
      functionName: "owner",
      authorizationList: undefined,
    })) as Address;
    const matches = owner.toLowerCase() === minter.address.toLowerCase();
    add({
      name: "owner() == basım cüzdanı",
      ok: matches,
      detail: matches ? owner : `kontrat sahibi ${owner}, basım cüzdanı ${minter.address}`,
      fix: matches
        ? undefined
        : "mint() onlyOwner. Ya kontratı doğru initialOwner ile yeniden dağıtın, ya da " +
          `mevcut sahiple transferOwnership(${minter.address}) çağırın.`,
    });
  } catch (err) {
    add({ name: "owner()", ok: false, detail: errorText(err) });
  }

  try {
    const balance = await client.getBalance({ address: minter.address });
    add({
      name: "Basım cüzdanı ETH bakiyesi",
      ok: balance > 0n,
      detail: `${formatEther(balance)} ETH`,
      fix:
        balance > 0n
          ? undefined
          : "Basım gazını bu cüzdan öder (alıcının ödemesi gazsızdır). Base ağında ETH gönderin.",
    });
  } catch (err) {
    add({ name: "Basım cüzdanı ETH bakiyesi", ok: false, detail: errorText(err) });
  }

  // --- 5. Gerçek mint simülasyonu ---
  // En değerli kontrol: kontratın çağrıya ne diyeceğini gaz harcamadan gösterir.
  try {
    const { result } = await client.simulateContract({
      address,
      abi: ABI,
      functionName: "mint",
      args: [minter.address, "data:application/json;base64,e30="],
      account: minter,
      authorizationList: undefined,
    });
    add({
      name: "mint() simülasyonu",
      ok: true,
      detail: `başarılı, sıradaki tokenId ${result}`,
    });
  } catch (err) {
    const message = errorText(err);
    add({
      name: "mint() simülasyonu",
      ok: false,
      detail: message,
      fix: /Ownable|unauthorized|0x118cdaa7/i.test(message)
        ? "Basım cüzdanı kontratın sahibi değil."
        : /insufficient funds/i.test(message)
          ? "Basım cüzdanında gaz için ETH yok."
          : "Kontrat çağrıyı reddediyor; sebep yukarıdaki tam hata metninde.",
    });
  }

  return done();
}

/** HTML'e gömülen metni zararsız hâle getirir. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Teşhisi tarayıcıda okunabilir bir sayfaya çevirir.
 *
 * Ham JSON'u tarayıcıda okumak zor ve hangi satıra bakılacağı belli değil.
 * Burada başarısız kontroller en üstte, ne yapılacağıyla birlikte duruyor.
 * Renkler arayüzün token'larıyla aynı (src/index.css).
 */
export function renderDiagnosisHtml(diagnosis: Diagnosis): string {
  const failed = diagnosis.checks.filter((c) => !c.ok);

  const row = (c: Check) => `
    <div class="row ${c.ok ? "ok" : "bad"}">
      <div class="mark">${c.ok ? "✓" : "✗"}</div>
      <div class="body">
        <div class="name">${escapeHtml(c.name)}</div>
        <pre class="detail">${escapeHtml(c.detail)}</pre>
        ${c.fix ? `<div class="fix">→ ${escapeHtml(c.fix)}</div>` : ""}
      </div>
    </div>`;

  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TollChit402 — bilet basımı teşhisi</title>
<style>
  :root{--bg:#050505;--surface:#0a0a0a;--surface2:#141414;--border:#1a1a1a;
        --border2:#2a2a2a;--text:#f5f5f5;--muted:#8b8f98;--dim:#6b7280;
        --accent:#10b981;--danger:#f87171}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);padding:32px 20px;
       font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:1.6}
  .wrap{max-width:860px;margin:0 auto}
  h1{font-size:15px;letter-spacing:3px;text-transform:uppercase;margin:0 0 4px}
  .verdict{padding:14px 16px;border:1px solid;border-radius:2px;margin:18px 0 26px}
  .verdict.ok{background:rgba(16,185,129,.08);border-color:rgba(16,185,129,.25);color:var(--accent)}
  .verdict.bad{background:rgba(248,113,113,.08);border-color:rgba(248,113,113,.25);color:var(--danger)}
  .row{display:flex;gap:12px;padding:12px 14px;border:1px solid var(--border);
       border-radius:2px;background:var(--surface);margin-bottom:8px}
  .row.bad{border-color:rgba(248,113,113,.25);background:rgba(248,113,113,.06)}
  .mark{flex:0 0 16px}
  .row.ok .mark{color:var(--accent)}
  .row.bad .mark{color:var(--danger)}
  .name{font-weight:700;letter-spacing:1.5px;font-size:12px}
  .detail{margin:4px 0 0;white-space:pre-wrap;word-break:break-word;color:var(--muted);font-size:12px}
  .fix{margin-top:8px;padding:8px 10px;background:var(--surface2);
       border-left:2px solid var(--accent);color:var(--text);font-size:12px}
  .sub{color:var(--dim);font-size:11px;letter-spacing:2px;text-transform:uppercase}
  .foot{margin-top:26px;color:var(--dim);font-size:11px}
  a{color:var(--muted)}
</style></head>
<body><div class="wrap">
  <h1><span lang="en">TollChit402</span> — bilet basımı teşhisi</h1>
  <div class="sub">Bu sayfa ödeme yapmadan yapılandırmayı ve zinciri kontrol eder</div>

  <div class="verdict ${diagnosis.ok ? "ok" : "bad"}">
    ${
      diagnosis.ok
        ? "Her kontrol başarılı. Basım çalışmalı; yine de bilet gelmiyorsa sunucu loglarındaki [receipt] satırlarına bakın."
        : `${failed.length} kontrol başarısız — aşağıdaki “→” satırları ne yapılacağını söylüyor.`
    }
  </div>

  ${failed.map(row).join("")}
  ${failed.length ? '<div class="sub" style="margin:22px 0 10px">Başarılı kontroller</div>' : ""}
  ${diagnosis.checks.filter((c) => c.ok).map(row).join("")}

  <div class="foot">
    Ham JSON: <a href="?format=json">?format=json</a> ·
    Yerelde aynı kontroller: <code>npm run doctor:receipt</code>
  </div>
</div></body></html>`;
}
