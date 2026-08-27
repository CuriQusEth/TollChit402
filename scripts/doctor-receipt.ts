/**
 * Bilet basımı teşhis aracı.
 *
 * Basım yolu bilinçli olarak sessiz: her hata yutulup `null` dönüyor ki bir
 * basım sorunu asla tamamlanmış bir ödemeyi bozmasın. Bu iyi bir tasarım ama
 * hata ayıklamayı zorlaştırıyor — bu betik o sessizliği delmek için var.
 *
 * Gerçek bir ödeme GEREKTİRMEZ: yapılandırmayı okur, zinciri sorgular ve
 * `mint` çağrısını simüle eder. Simülasyon gaz harcamaz ama kontratın gerçekte
 * ne diyeceğini (örneğin OwnableUnauthorizedAccount) aynen gösterir.
 *
 * Kullanım:
 *   npm run doctor:receipt
 */
import { config } from "dotenv";
import {
  createPublicClient,
  formatEther,
  http,
  type Address,
} from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

config();

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;

/** api/_receipt.ts'teki ABI ile aynı olmalı. */
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
    // OZ 5.x onlyOwner reddini custom error ile bildiriyor. ABI'de olmazsa
    // viem yalnızca ham selector'ı (0x118cdaa7) gösterir.
    type: "error",
    name: "OwnableUnauthorizedAccount",
    inputs: [{ name: "account", type: "address" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

let failed = false;

function ok(label: string, detail: string) {
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
}

function bad(label: string, detail: string, fix?: string) {
  failed = true;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  if (fix) console.log(`      → ${fix}`);
}

function short(value: string): string {
  return value.length > 66 ? `${value.slice(0, 63)}…` : value;
}

async function main() {
  console.log("\nTollChit402 bilet basımı teşhisi\n");

  // --- 1. Yapılandırma ---
  console.log("1. Ortam değişkenleri");
  const contract = process.env.TOLLCHIT_CONTRACT_ADDRESS?.trim();
  const key = process.env.RECEIPT_MINTER_PRIVATE_KEY?.trim();

  if (!contract) {
    bad(
      "TOLLCHIT_CONTRACT_ADDRESS",
      "tanımlı değil",
      "Basım tamamen kapalı. .env dosyanıza (Vercel'de Environment Variables'a) ekleyin."
    );
  } else if (!EVM_ADDRESS.test(contract)) {
    bad("TOLLCHIT_CONTRACT_ADDRESS", `geçersiz: "${contract}"`);
  } else {
    ok("TOLLCHIT_CONTRACT_ADDRESS", contract);
  }

  if (!key) {
    bad(
      "RECEIPT_MINTER_PRIVATE_KEY",
      "tanımlı değil",
      "Basım tamamen kapalı. Kontratın sahibi olan cüzdanın private key'i olmalı."
    );
  } else if (!PRIVATE_KEY.test(key)) {
    bad(
      "RECEIPT_MINTER_PRIVATE_KEY",
      "geçersiz biçim",
      "0x ile başlayan 64 haneli bir private key olmalı."
    );
  } else {
    ok("RECEIPT_MINTER_PRIVATE_KEY", "tanımlı");
  }

  const rpc = process.env.BASE_RPC_URL?.trim();
  ok("BASE_RPC_URL", rpc || "(tanımsız — viem'in public RPC'si kullanılacak)");

  if (!contract || !EVM_ADDRESS.test(contract) || !key || !PRIVATE_KEY.test(key)) {
    console.log("\nYapılandırma eksik; zincir kontrolleri atlanıyor.\n");
    process.exit(1);
  }

  const minter = privateKeyToAccount(key as `0x${string}`);
  const client = createPublicClient({ chain: base, transport: http(rpc || undefined) });
  const address = contract as Address;

  // --- 2. Zincir ve kontrat ---
  console.log("\n2. Base mainnet (chain 8453)");
  try {
    const chainId = await client.getChainId();
    if (chainId === 8453) ok("RPC ağı", `chain ${chainId}`);
    else
      bad(
        "RPC ağı",
        `chain ${chainId} — Base mainnet değil`,
        "BASE_RPC_URL yanlış ağa bakıyor."
      );
  } catch (err) {
    bad("RPC erişimi", (err as Error).message, "BASE_RPC_URL erişilebilir mi?");
    console.log("");
    process.exit(1);
  }

  const code = await client.getCode({ address });
  if (!code || code === "0x") {
    bad(
      "Kontrat bytecode",
      "bu adreste kontrat YOK",
      "Adres yanlış ya da kontrat başka bir ağa (örn. Base Sepolia) dağıtılmış. " +
        `Kontrol: https://basescan.org/address/${address}`
    );
    console.log("");
    process.exit(1);
  }
  ok("Kontrat bytecode", `${(code.length - 2) / 2} bayt`);

  // --- 3. ABI uyumu ---
  console.log("\n3. ABI uyumu");
  let minted: bigint | null = null;
  try {
    minted = (await client.readContract({
      address,
      abi: ABI,
      functionName: "totalMinted",
      authorizationList: undefined,
    })) as bigint;
    ok("totalMinted()", `${minted} bilet basılmış`);
  } catch (err) {
    bad(
      "totalMinted()",
      short((err as Error).message),
      "Bu adresteki kontrat TollChit402 değil ya da ABI eşleşmiyor."
    );
  }

  try {
    const symbol = (await client.readContract({
      address,
      abi: ABI,
      functionName: "symbol",
      authorizationList: undefined,
    })) as string;
    if (symbol === "CHIT402") ok("symbol()", symbol);
    else bad("symbol()", `"${symbol}" — CHIT402 bekleniyordu`, "Yanlış kontrat olabilir.");
  } catch (err) {
    bad("symbol()", short((err as Error).message));
  }

  // --- 4. Sahiplik ---
  console.log("\n4. Sahiplik ve bakiye");
  try {
    const owner = (await client.readContract({
      address,
      abi: ABI,
      functionName: "owner",
      authorizationList: undefined,
    })) as Address;

    if (owner.toLowerCase() === minter.address.toLowerCase()) {
      ok("owner() == basım cüzdanı", minter.address);
    } else {
      bad(
        "owner() != basım cüzdanı",
        `kontrat sahibi ${owner}, basım cüzdanı ${minter.address}`,
        "mint() onlyOwner. Ya kontratı doğru initialOwner ile yeniden dağıtın, ya da " +
          `mevcut sahiple transferOwnership(${minter.address}) çağırın.`
      );
    }
  } catch (err) {
    bad("owner()", short((err as Error).message));
  }

  const balance = await client.getBalance({ address: minter.address });
  if (balance === 0n) {
    bad(
      "Basım cüzdanı ETH bakiyesi",
      "0",
      "Basım gazını bu cüzdan öder. Base ağında bir miktar ETH gönderin."
    );
  } else {
    ok("Basım cüzdanı ETH bakiyesi", `${formatEther(balance)} ETH`);
  }

  // --- 5. Gerçek mint simülasyonu ---
  // En değerli kontrol: kontratın çağrıya ne diyeceğini gaz harcamadan gösterir.
  console.log("\n5. mint() simülasyonu (gaz harcamaz)");
  try {
    const { result } = await client.simulateContract({
      address,
      abi: ABI,
      functionName: "mint",
      args: [minter.address, "data:application/json;base64,e30="],
      account: minter,
      // `authorizationList: undefined` yalnızca tip düzeyinde gerekiyor:
      // projede strictNullChecks kapalı olduğu için viem'in koşullu tipi bu
      // isteğe bağlı alanı zorunlu sayıyor.
      authorizationList: undefined,
    });
    ok("mint() simülasyonu", `başarılı, sıradaki tokenId ${result}`);
  } catch (err) {
    const message = (err as Error).message;
    // 0x118cdaa7 = OwnableUnauthorizedAccount selector'ı; ABI'de tanımlı olsa
    // bile bazı RPC'ler yalnızca ham veriyi döndürüyor.
    const hint =
      /Ownable|unauthorized|0x118cdaa7/i.test(message)
        ? "Basım cüzdanı kontratın sahibi değil (bkz. 4. adım)."
        : /insufficient funds/i.test(message)
          ? "Basım cüzdanında gaz için ETH yok (bkz. 4. adım)."
          : "Kontrat çağrıyı reddediyor; sebep yukarıdaki tam hata metninde.";
    // Kırpılmıyor: gerçek sebep çoğu zaman mesajın sonunda.
    failed = true;
    console.log("  ✗ mint() simülasyonu başarısız:");
    for (const line of message.split("\n")) console.log(`      ${line}`);
    console.log(`      → ${hint}`);
  }

  console.log(
    failed
      ? "\nSonuç: en az bir kontrol başarısız — yukarıdaki → satırlarını izleyin.\n"
      : "\nSonuç: her şey yolunda. Basım çalışmalı; çalışmıyorsa sunucu loglarındaki [receipt] satırlarına bakın.\n"
  );
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("\nTeşhis çalıştırılamadı:", err);
  process.exit(1);
});
