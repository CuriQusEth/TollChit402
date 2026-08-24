#!/usr/bin/env node
/**
 * x402-pay MCP sunucusu.
 *
 * Bu proje bir x402 endpoint'i satar; burada onun *alıcı* tarafı bir MCP aracı
 * olarak sunuluyor. Claude gibi bir ajan aracı çağırdığında ödeme, aşağıdaki
 * cüzdandan otomatik olarak yapılır — insan onayı istenmez.
 */
import { config } from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import {
  x402Client,
  wrapFetchWithPayment,
  decodePaymentResponseHeader,
} from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import type { ClientEvmSigner } from "@x402/evm";

config();

const DEFAULT_RESOURCE_URL = "https://x402-pay-iota.vercel.app/api/premium";

const privateKey = process.env.EVM_PRIVATE_KEY?.trim();
if (!privateKey) {
  console.error(
    "EVM_PRIVATE_KEY tanımlı değil. mcp-server/.env dosyasına ekleyin " +
      "(`cp .env.example .env`)."
  );
  process.exit(1);
}
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  console.error(
    "EVM_PRIVATE_KEY geçersiz: 0x ile başlayan 64 haneli bir private key olmalı."
  );
  process.exit(1);
}

const resourceServerUrl = (
  process.env.RESOURCE_SERVER_URL?.trim() || DEFAULT_RESOURCE_URL
).replace(/\/$/, "");
const defaultRecipient = process.env.PAYMENT_RECIPIENT?.trim();

const account = privateKeyToAccount(privateKey as `0x${string}`);
const publicClient = createPublicClient({ chain: base, transport: http() });

/**
 * Yerel hesabı x402'nin beklediği signer arayüzüne uyarlar.
 *
 * Tarayıcı tarafındaki eşdeğeri (src/components/PaymentForm.tsx) imzayı ayrıca
 * doğrular ve recovery byte'ını düzeltir; ikisi de cüzdan kaynaklı sorunlardır.
 * Yerel bir hesap her zaman 65 baytlık, çözümlenebilir bir imza ürettiği için
 * burada gerekmiyorlar.
 */
const signer: ClientEvmSigner = {
  address: account.address,
  // x402 EIP-712 yükünü düz kayıtlarla tarif eder; viem ise bu şekilden geri
  // kurulamayan dar generic'ler çıkarır. Bu iki assertion yalnızca o sınırda.
  signTypedData: (msg) =>
    account.signTypedData(
      msg as Parameters<typeof account.signTypedData>[0]
    ),
  readContract: (args) =>
    publicClient.readContract(
      args as Parameters<typeof publicClient.readContract>[0]
    ),
};

const client = new x402Client();
client.register("eip155:*", new ExactEvmScheme(signer));
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

/**
 * Ücretli endpoint'i çağırır, ödemeyi yapar ve yanıtı makbuzla döndürür.
 */
async function callPremium(recipient?: string) {
  const payTo = recipient?.trim() || defaultRecipient;
  if (payTo && !/^0x[0-9a-fA-F]{40}$/.test(payTo)) {
    throw new Error(
      `Alıcı adresi geçersiz: "${payTo}". 0x ile başlayan 40 haneli bir EVM adresi olmalı.`
    );
  }

  const response = await fetchWithPayment(resourceServerUrl, {
    method: "GET",
    headers: payTo ? { "x-payment-recipient": payTo } : undefined,
  });

  if (!response.ok) {
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch {
      // Gövde okunamadıysa aşağıdaki genel mesaja düşülür.
    }

    if (errorBody.includes("invalid_exact_evm_signature")) {
      throw new Error(
        "Ödeme imzası facilitator tarafından reddedildi. EVM_PRIVATE_KEY'in " +
          "geçerli bir EOA hesabına ait olduğundan emin olun."
      );
    }
    if (errorBody.includes("invalid_exact_evm_transaction_simulation_failed")) {
      throw new Error(
        `Ödeme simülasyonu başarısız oldu. ${account.address} adresinde Base ağında ` +
          "yeterli USDC bakiyesi (en az 0.05 USDC) olduğundan emin olun."
      );
    }
    throw new Error(
      `Sunucu Hatası: ${response.status} ${response.statusText} - ${errorBody}`
    );
  }

  const data = (await response.json()) as Record<string, unknown>;

  // Settlement bilgisi PAYMENT-RESPONSE başlığından gelir. @x402/extensions'ın
  // extractReceiptFromResponse'u burada işe yaramaz: o, sunucunun bildirmediği
  // offer-receipt eklentisine ait ve her zaman undefined döner.
  let txHash: string | undefined;
  try {
    const header =
      response.headers.get("x-payment-response") ??
      response.headers.get("payment-response");
    if (header) {
      const settlement = decodePaymentResponseHeader(header) as
        | { transaction?: string }
        | undefined;
      txHash = settlement?.transaction;
    }
  } catch {
    // Başlık okunamazsa ödeme yine de geçerlidir; tx hash'siz döneriz.
  }

  return { ...data, txHash };
}

const server = new McpServer({ name: "x402-pay", version: "1.0.0" });

server.tool(
  "get_premium_data",
  "x402 ile korunan premium endpoint'ten veri getirir. Her çağrı Base " +
    "mainnet üzerinde 0.05 USDC tutarında bir ödeme yapar; ödeme yapılandırılmış " +
    "cüzdandan otomatik olarak çekilir ve insan onayı istenmez. Endpoint'in JSON " +
    "yanıtını ve settlement işleminin hash'ini döndürür.",
  {
    recipient: z
      .string()
      .optional()
      .describe(
        "İsteğe bağlı. Ödemenin gideceği Base adresi; PAYMENT_RECIPIENT " +
          "ayarını bu çağrı için geçersiz kılar."
      ),
  },
  async ({ recipient }) => {
    const result = await callPremium(recipient);
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result, null, 2) },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);

// stdout MCP protokolüne ait; her günlük satırı stderr'e gitmeli.
console.error(
  `x402-pay MCP sunucusu hazır — ödeyen ${account.address}, hedef ${resourceServerUrl}`
);
