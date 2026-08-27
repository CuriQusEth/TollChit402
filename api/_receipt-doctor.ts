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
  const contract = process.env.TOLLCHIT_CONTRACT_ADDRESS?.trim();
  const key = process.env.RECEIPT_MINTER_PRIVATE_KEY?.trim();

  const contractOk = Boolean(contract) && EVM_ADDRESS.test(contract as string);
  add({
    name: "TOLLCHIT_CONTRACT_ADDRESS",
    ok: contractOk,
    detail: contract ? (contractOk ? contract : `geçersiz: "${contract}"`) : "tanımlı değil",
    fix: contractOk
      ? undefined
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
