# x402-pay MCP sunucusu

Bu paket, x402-pay'in ücretli endpoint'ini bir **MCP aracı** olarak sunar. Claude
gibi bir ajan aracı çağırdığında, 402 yanıtı otomatik karşılanır: ödeme
yapılandırılmış cüzdandan imzalanır, CDP Facilitator doğrulayıp Base üzerinde
settle eder ve endpoint'in JSON yanıtı ajana döner.

Araç: **`get_premium_data`**

| Parametre | Zorunlu | Açıklama |
| --- | --- | --- |
| `recipient` | hayır | Ödemenin gideceği Base adresi; `PAYMENT_RECIPIENT`'ı bu çağrı için geçersiz kılar |

Dönen değer, endpoint'in JSON yanıtı artı settlement işleminin `txHash`'idir.

## Güvenlik

`EVM_PRIVATE_KEY` **otonom imzalayan bir sıcak cüzdandır**. Ajan her araç
çağrısında onay sormadan ödeme yapar. Yalnızca gözden çıkarabileceğiniz küçük bir
USDC bakiyesi tutun.

## Kurulum

```bash
cd mcp-server
npm install
cp .env.example .env      # EVM_PRIVATE_KEY'i doldurun
npm run build
```

Bu paket kök projenin bir workspace'i **değildir**; ayrı bir uzun ömürlü süreç
olarak çalıştığı için kendi `node_modules`'ü ile bağımsızdır.

## Claude Desktop

`claude_desktop_config.json` dosyanıza ekleyin (yolu mutlak yazın):

```json
{
  "mcpServers": {
    "x402-pay": {
      "command": "node",
      "args": ["/mutlak/yol/x402-Pay/mcp-server/dist/index.js"],
      "env": {
        "EVM_PRIVATE_KEY": "0x...",
        "RESOURCE_SERVER_URL": "https://x402-pay-iota.vercel.app/api/premium",
        "PAYMENT_RECIPIENT": "0x..."
      }
    }
  }
}
```

## Claude Code

```bash
claude mcp add x402-pay \
  --env EVM_PRIVATE_KEY=0x... \
  --env RESOURCE_SERVER_URL=https://x402-pay-iota.vercel.app/api/premium \
  -- node /mutlak/yol/x402-Pay/mcp-server/dist/index.js
```

## Notlar

- Günlükler `stderr`'e yazılır; `stdout` MCP protokolüne ayrılmıştır.
- Settlement hash'i `PAYMENT-RESPONSE` başlığından okunur. `@x402/extensions`'ın
  `extractReceiptFromResponse` fonksiyonu burada kullanılamaz: o, sunucunun
  bildirmediği offer-receipt eklentisine aittir ve her zaman `undefined` döner.
