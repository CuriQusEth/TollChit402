# x402-Pay

Base Mainnet üzerinde USDC ile x402 v2 mikro ödemeleri yapan bir demo. Uygulama
hem **alıcı** hem **satıcı** tarafını içerir:

- **Satıcı:** `/api/premium`, x402 ile korunan bir endpoint. Ödemeleri
  [CDP Facilitator](https://docs.cdp.coinbase.com) doğrular ve Base üzerinde settle eder.
- **Alıcı:** React arayüzü, tarayıcı cüzdanıyla (wagmi) bu endpoint'e ödeme yapar.

## Özellikler

- Base Mainnet üzerinde USDC ile mikro ödemeler (istek başına $0.05).
- Doğrudan tarayıcı cüzdanı entegrasyonu (MetaMask, Rabby, Coinbase Wallet).
- Ödeme doğrulama ve settlement için CDP Facilitator; kendi facilitator'ınızı
  işletmeniz gerekmez.
- Private key sunucuda tutulmaz; tüm imzalama kullanıcının cüzdanında yapılır.

## Kurulum

1. Bağımlılıkları yükleyin:
   ```bash
   npm install
   ```

2. Ortam değişkenlerini ayarlayın:
   ```bash
   cp .env.example .env
   ```

   | Değişken | Açıklama |
   | --- | --- |
   | `CDP_API_KEY_ID` | CDP API anahtar kimliği ([CDP Portal](https://portal.cdp.coinbase.com)) |
   | `CDP_API_KEY_SECRET` | CDP API anahtar gizi |
   | `PAYMENT_RECIPIENT_ADDRESS` | Ödemelerin (USDC) gideceği Base adresi |

   `.env` git tarafından yok sayılır; anahtarlarınızı commit etmeyin.

3. Geliştirme sunucusunu başlatın:
   ```bash
   npm run dev
   ```

4. Tarayıcınızda açın ve cüzdanınızı bağlayın (Base Mainnet).

## Prodüksiyon

```bash
npm run build
npm start
```

Vercel'de `/api/premium` serverless fonksiyon olarak çalışır ve geliştirme
sunucusuyla aynı router'ı kullanır.

## Notlar

- Proje gerçek mainnet üzerinde çalışacak şekilde yapılandırılmıştır: gerçek USDC
  bakiyesi ve gas (ETH) gerektirir.
- x402 EIP-3009 ödemesi, imzadan çözümlenebilen bir EOA hesabı gerektirir; akıllı
  kontrat cüzdanları (ERC-1271/6492) facilitator tarafından reddedilebilir.
