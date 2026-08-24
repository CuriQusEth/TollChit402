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
import { UptoEvmScheme } from "@x402/evm/upto/client";
import type { ClientEvmSigner } from "@x402/evm";

config();

const DEFAULT_RESOURCE_URL = "https://x402-pay-iota.vercel.app/api/premium";

/**
 * Paket -> yol soneki.
 *
 * Kaynak tablo kök projedeki shared/tiers.ts; burada küçük bir kopyası tutuluyor
 * çünkü bu paket bilinçli olarak bağımsızdır ve prodüksiyonda sunucuyla aynı
 * dosya sistemini paylaşmaz. Yeni paket eklenirse iki taraf da güncellenmeli.
 */
const TIER_PATHS = {
  basic: "",
  pro: "/pro",
  metered: "/metered",
} as const;

type TierId = keyof typeof TIER_PATHS;

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
// metered paketi upto ile fiyatlanır; istemci şeması olmadan o 402 karşılanamaz.
client.register("eip155:*", new UptoEvmScheme(signer));
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

/**
 * Ücretli endpoint'i çağırır, ödemeyi yapar ve yanıtı makbuzla döndürür.
 */
async function callPremium(recipient?: string, tier: TierId = "basic", units?: number) {
  const payTo = recipient?.trim() || defaultRecipient;
  if (payTo && !/^0x[0-9a-fA-F]{40}$/.test(payTo)) {
    throw new Error(
      `Alıcı adresi geçersiz: "${payTo}". 0x ile başlayan 40 haneli bir EVM adresi olmalı.`
    );
  }

  // Facilitator kendine transferi reddediyor (self_send_not_allowed); imzadan
  // önce yakalamak boşa bir ödeme turundan kurtarır.
  if (payTo && payTo.toLowerCase() === account.address.toLowerCase()) {
    throw new Error(
      `Alıcı adresi ödeme yapan cüzdanla aynı (${account.address}). ` +
        "Kendinize ödeme yapamazsınız; farklı bir alıcı adresi verin."
    );
  }

  // Paket yolu, yapılandırılan temel URL'in üzerine eklenir.
  const target = new URL(resourceServerUrl + TIER_PATHS[tier]);
  if (tier === "metered" && units !== undefined) {
    target.searchParams.set("units", String(units));
  }

  const response = await fetchWithPayment(target.toString(), {
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

    // Reddedilen bir ödemede gövde boş {} olur; asıl sebep 402'nin
    // PAYMENT-REQUIRED başlığındaki `error` alanındadır.
    const header =
      response.headers.get("payment-required") ??
      response.headers.get("x-payment-required");
    if (header) {
      try {
        const decoded = JSON.parse(
          Buffer.from(header, "base64").toString()
        ) as { error?: unknown };
        if (typeof decoded.error === "string") {
          errorBody = `${errorBody} ${decoded.error}`;
        }
      } catch {
        // Başlık çözülemezse gövdeyle devam edilir.
      }
    }

    if (errorBody.includes("invalid_exact_evm_signature")) {
      throw new Error(
        "Ödeme imzası facilitator tarafından reddedildi. EVM_PRIVATE_KEY'in " +
          "geçerli bir EOA hesabına ait olduğundan emin olun."
      );
    }
    if (errorBody.includes("self_send_not_allowed")) {
      throw new Error(
        "Facilitator kendine yapılan ödemeyi reddetti: alıcı adres ödeme yapan " +
          "cüzdanla aynı. Farklı bir alıcı adresi verin."
      );
    }
    if (
      errorBody.includes("invalid_exact_evm_payload_signature") ||
      errorBody.includes("execution reverted")
    ) {
      throw new Error(
        "Facilitator imzayı doğrulayamadı: ödeyen adreste kontrat kodu var ve " +
          "isValidSignature çağrısı revert etti. EVM_PRIVATE_KEY standart bir EOA " +
          "hesabına ait olmalı; akıllı kontrat cüzdanları desteklenmiyor."
      );
    }
    if (errorBody.includes("eip6492_factory_not_allowed")) {
      throw new Error(
        "Ödeyen hesap henüz zincire dağıtılmamış bir akıllı hesap (ERC-6492) ve " +
          "facilitator bu factory'yi kabul etmiyor. Hesabı dağıtın ya da EOA kullanın."
      );
    }
    if (errorBody.includes("invalid_exact_evm_transaction_simulation_failed")) {
      throw new Error(
        `Ödeme simülasyonu başarısız oldu. ${account.address} adresinde Base ağında ` +
          "seçilen paket için yeterli USDC bakiyesi olduğundan emin olun."
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
    "mainnet üzerinde seçilen pakete göre bir USDC ödemesi yapar; ödeme yapılandırılmış " +
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
    tier: z
      .enum(["basic", "pro", "metered"])
      .optional()
      .describe(
        "İsteğe bağlı paket. basic $0.001, pro $0.25 sabit ücretlidir; " +
          "metered en fazla $0.50 yetkilendirir ve yalnızca kullanılan " +
          "birimleri tahsil eder. Varsayılan: basic."
      ),
    units: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Yalnızca metered paketinde geçerli. Tahsil edilecek birim sayısı " +
          "(birim başına 0.005 USDC); tavana kadar kırpılır."
      ),
  },
  async ({ recipient, tier, units }) => {
    const result = await callPremium(recipient, tier ?? "basic", units);
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
