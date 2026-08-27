/**
 * PaymentReceipt.sol'u solc-js ile derler.
 *
 * Projeye Foundry ya da Hardhat eklenmiyor: tek bir kontrat için bütün bir
 * toolchain kurmak yerine solc'un JS dağıtımı doğrudan çağrılıyor. Derleme
 * yalnızca dağıtım anında (contracts/scripts/deploy.ts) çalışır — istek yolunda
 * solc'a hiç dokunulmaz.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { Abi } from "viem";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

/** Derlenecek kontratın adı ve dosyası. */
const CONTRACT_FILE = "PaymentReceipt.sol";
const CONTRACT_NAME = "PaymentReceipt";

/** solc-js'in tip tanımı yok; kullandığımız tek fonksiyon bu. */
type Solc = {
  compile(input: string, callbacks: { import: (p: string) => ImportResult }): string;
  version(): string;
};

type ImportResult = { contents: string } | { error: string };

type SolcOutput = {
  errors?: { severity: string; formattedMessage?: string; message?: string }[];
  contracts?: Record<
    string,
    Record<string, { abi: Abi; evm: { bytecode: { object: string } } }>
  >;
};

/**
 * solc'un import'larını çözer.
 *
 * OpenZeppelin dosyaları node_modules'tan okunuyor; solc kendi başına dosya
 * sistemine erişemediği için her import bu geri çağrıdan geçmek zorunda.
 */
function resolveImport(importPath: string): ImportResult {
  try {
    // Göreli import'lar kontrat klasörüne, paket import'ları node_modules'a.
    const file = importPath.startsWith(".")
      ? path.resolve(here, "..", importPath)
      : require.resolve(importPath, { paths: [process.cwd()] });
    return { contents: fs.readFileSync(file, "utf8") };
  } catch (err) {
    return { error: `İçe aktarılamadı: ${importPath} (${(err as Error).message})` };
  }
}

export type CompiledContract = {
  abi: Abi;
  bytecode: `0x${string}`;
  solcVersion: string;
};

/** Kontratı derler; bir hata varsa fırlatır. */
export function compilePaymentReceipt(): CompiledContract {
  const solc = require("solc") as Solc;
  const source = fs.readFileSync(path.resolve(here, "..", CONTRACT_FILE), "utf8");

  const input = {
    language: "Solidity",
    sources: { [CONTRACT_FILE]: { content: source } },
    settings: {
      // Makbuz basımı sık çağrılan bir yol; optimizer gaz maliyetini düşürür.
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };

  const output = JSON.parse(
    solc.compile(JSON.stringify(input), { import: resolveImport })
  ) as SolcOutput;

  // Uyarılar derlemeyi durdurmaz ama görünür olmalı; yalnızca error seviyesi
  // ölümcüldür.
  const fatal = (output.errors ?? []).filter((e) => e.severity === "error");
  for (const warning of (output.errors ?? []).filter((e) => e.severity !== "error")) {
    console.warn(warning.formattedMessage ?? warning.message);
  }
  if (fatal.length > 0) {
    throw new Error(
      "Derleme başarısız:\n" +
        fatal.map((e) => e.formattedMessage ?? e.message).join("\n")
    );
  }

  const compiled = output.contracts?.[CONTRACT_FILE]?.[CONTRACT_NAME];
  if (!compiled) {
    throw new Error(`${CONTRACT_NAME} derleme çıktısında bulunamadı.`);
  }

  return {
    abi: compiled.abi,
    bytecode: `0x${compiled.evm.bytecode.object}`,
    solcVersion: solc.version(),
  };
}
