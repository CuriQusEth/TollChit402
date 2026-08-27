/**
 * TollChit402 kontratını Base mainnet'e dağıtır.
 *
 * Bu betik operatör tarafından ELLE, BİR KEZ çalıştırılır — istek yolunun bir
 * parçası değildir. Çıkan adresi .env'deki TOLLCHIT_CONTRACT_ADDRESS alanına
 * yazın.
 *
 * Kullanım:
 *   npm run deploy:receipt
 *
 * Gerekenler:
 *   RECEIPT_MINTER_PRIVATE_KEY — dağıtımı yapan ve kontratın sahibi olacak
 *     cüzdan. Base üzerinde gaz için bir miktar ETH bulundurmalı.
 *   BASE_RPC_URL (isteğe bağlı) — kendi RPC sağlayıcınız.
 */
import { config } from "dotenv";
import { createPublicClient, createWalletClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { compileTollChit402 } from "./compile.js";

config();

const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;

/**
 * Dağıtım için gereken tek ABI parçası: constructor.
 *
 * `as const` şart — derleyiciden gelen geniş `Abi` tipiyle viem, deployContract
 * çağrısını blob işlemi zannedip `kzg` istiyor. Aşağıda derlenmiş ABI'ye karşı
 * doğrulanıyor, böylece kontratın constructor'ı değişirse burası sessizce
 * eskimiyor.
 */
const CONSTRUCTOR_ABI = [
  {
    type: "constructor",
    stateMutability: "nonpayable",
    inputs: [{ name: "initialOwner", type: "address" }],
  },
] as const;

async function main() {
  const key = process.env.RECEIPT_MINTER_PRIVATE_KEY?.trim();
  if (!key || !PRIVATE_KEY.test(key)) {
    throw new Error(
      "RECEIPT_MINTER_PRIVATE_KEY tanımlı değil ya da geçersiz: 0x ile başlayan " +
        "64 haneli bir private key olmalı."
    );
  }

  const account = privateKeyToAccount(key as `0x${string}`);
  const transport = http(process.env.BASE_RPC_URL || undefined);
  const publicClient = createPublicClient({ chain: base, transport });
  const walletClient = createWalletClient({ account, chain: base, transport });

  const { abi, bytecode, solcVersion } = compileTollChit402();
  console.log(`solc ${solcVersion}`);

  const constructorAbi = abi.find((item) => item.type === "constructor");
  const constructorInputs =
    constructorAbi && "inputs" in constructorAbi ? constructorAbi.inputs : [];
  if (constructorInputs.length !== 1 || constructorInputs[0].type !== "address") {
    throw new Error(
      "Kontratın constructor'ı beklenenden farklı; deploy.ts'teki CONSTRUCTOR_ABI güncellenmeli."
    );
  }

  console.log(`Dağıtan / sahip: ${account.address}`);

  // Gaz gerçek ETH ile ödeniyor; bakiyeyi önden kontrol etmek, işlemi
  // gönderdikten sonra alınan anlamsız bir hatadan iyidir.
  const balance = await publicClient.getBalance({ address: account.address });
  if (balance === 0n) {
    throw new Error(
      `${account.address} adresinde Base ağında hiç ETH yok. Dağıtım gazı için ` +
        "bir miktar ETH gönderin."
    );
  }

  const hash = await walletClient.deployContract({
    abi: CONSTRUCTOR_ABI,
    bytecode,
    account,
    chain: base,
    // Kontrat dağıtımı normal bir EIP-1559 işlemi. `kzg: undefined` yalnızca
    // tip düzeyinde gerekiyor: projede strictNullChecks kapalı olduğu için
    // viem'in "blob işlemi mi?" koşullu tipi blob dalına düşüyor ve kzg'yi
    // zorunlu sayıyor. Çalışma zamanında bir etkisi yok.
    type: "eip1559",
    kzg: undefined,
    // Kontratın sahibi dağıtan cüzdan olur; sunucu makbuzları bu cüzdanla basar.
    args: [account.address],
  });
  console.log(`Dağıtım işlemi: ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error(`Dağıtım başarısız oldu. İşlem: ${hash}`);
  }

  console.log("");
  console.log("Dağıtım tamam. .env dosyanıza ekleyin:");
  console.log(`TOLLCHIT_CONTRACT_ADDRESS=${receipt.contractAddress}`);
  console.log("");
  console.log(`BaseScan: https://basescan.org/address/${receipt.contractAddress}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
