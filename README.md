# x402-pay Cambrian Integration

Bu proje, Base Mainnet'te wagmi cüzdanı ile Cambrian API'ye x402 v2 protokolüyle ödeme yapan bir demodur.

## Özellikler

- Base Mainnet üzerinde USDC ile mikro ödemeler (istek başına $0.05).
- Doğrudan tarayıcı cüzdanı entegrasyonu (MetaMask, Rabby, Coinbase Smart Wallet).
- x402 ödeme protokolü v2 kullanılarak Cambrian API (`https://x402.cambrian.org`) erişimi.

## Kurulum

1. Bağımlılıkları yükleyin:
   ```bash
   npm install
   ```

2. Geliştirme sunucusunu başlatın:
   ```bash
   npm run dev
   ```

3. Tarayıcınızda açın ve cüzdanınızı bağlayın (Base Mainnet).

## Notlar

- Bu proje, gerçek mainnet üzerinde çalışacak şekilde yapılandırılmıştır. Gerçek USDC bakiyesi ve gas fee (ETH) gerektirir.
- Private key sunucuda tutulmaz, tüm imzalama işlemleri kullanıcının tarayıcı cüzdanı üzerinden güvenli bir şekilde yapılır.
