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
   | `PAYMENT_RECIPIENT_ADDRESS` | İsteğe bağlı. Paneldeki alan boş bırakılırsa kullanılacak Base adresi |
   | `CDP_FACILITATOR_BASE_URL` | İsteğe bağlı. Farklı bir facilitator (staging/canary) hedeflemek için |
   | `BUILDER_CODE` | İsteğe bağlı. ERC-8021 Base Builder Code; tanımsızsa projenin kendi kodu kullanılır |

   `CDP_API_KEY_ID` iki biçimi de kabul eder:
   `organizations/<org-uuid>/apiKeys/<key-uuid>` veya yalnızca `<key-uuid>`.
   CDP portalı etiketleri tarayıcı diline göre çevirdiği için kopyaladığınız
   değer `kuruluşlar/...` gibi görünebilir; bu durumda değer otomatik olarak
   düzeltilir ve bir uyarı yazılır. Tanınmayan bir biçim ise açık bir hata verir.

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

## Ödeme alıcısı

Arayüzdeki **Recipient Address** alanına yazılan adres, `x-payment-recipient`
başlığıyla sunucuya gider ve o isteğin `payTo` değeri olur. Alan boşsa
`PAYMENT_RECIPIENT_ADDRESS` kullanılır; ikisi de yoksa endpoint 400 döner.

Bunun anlamına dikkat: alıcıyı **ödeyen** seçer. Bu, ödeme akışının bir
demosudur — gelir toplama yolu değil, çünkü ziyaretçi kendi cüzdanını
yazabilir. Her ödemeyi tek bir cüzdana sabitlemek için
`PAYMENT_RECIPIENT_ADDRESS` tanımlayın ve arayüzdeki alanı kaldırın.

## Paketler

| Paket | Yol | Şema | Fiyat |
| --- | --- | --- | --- |
| Basic | `/api/premium` | `exact` | $0.05 |
| Pro | `/api/premium/pro` | `exact` | $0.25 |
| Metered | `/api/premium/metered?units=N` | `upto` | en fazla $0.50 |

`metered`, `upto` şemasını kullanır: istemci bir tavan yetkilendirir, sunucu
`?units=` değerinden gerçek tutarı hesaplayıp `setSettlementOverrides` ile
tahsil eder. Talep edilen birim sayısı tavana kırpılır, çünkü yetkilendirilenin
üstünde bir settlement reddedilir.

Paket tablosu `shared/tiers.ts` içindedir; sunucu, tarayıcı ve agent card aynı
kaynaktan okur.

## İstatistikler

`GET /api/stats`, toplam ödeme sayısını ve USDC hacmini döner. Vercel KV
bağlıysa sayaçlar kalıcıdır; değilse bellekte tutulur ve her yeniden başlatmada
sıfırlanır — yanıttaki `persistent` alanı hangisinin geçerli olduğunu söyler.
Yalnızca doğrulanmış ödemeler sayılır; 402 dönen istekler sayılmaz.

## AI ajanlarıyla ödeme

Endpoint standart bir x402 ucu olduğu için, x402 ödeyebilen her ajan istemcisi
onu çağırabilir. İki yol var:

### Base MCP (önerilen — anahtar paylaşmadan)

[Base MCP](https://docs.base.org/agents/quickstart) barındırılan bir MCP
sunucusudur (`https://mcp.base.org`); asistanınızı kendi Base Account'unuza
bağlar ve x402 uçlarını ödeyebilir. Kurulacak bir şey yok, bu projeye de bir
bağımlılık eklemez.

```bash
# Claude Code
claude mcp add --transport http base-mcp https://mcp.base.org
```

Claude, ChatGPT, Cursor ve Perplexity için bağlantı adımları Base'in
quickstart'ındadır. Bağladıktan sonra asistana şunu söylemeniz yeterli:

```
https://<alan-adiniz>/api/premium adresine x402 ile öde ve dönen veriyi göster
```

Her ödeme Base Account'ta onayınıza sunulur — özel anahtar hiçbir yere
kopyalanmaz.

**Akıllı cüzdan uyarısı:** Base Account bir akıllı hesaptır ve bu endpoint'i
şu an **ödeyemez**. `exact` şeması EIP-3009 kullanır; facilitator, imzayı
doğrulamak için digest'i doğrudan hesabın `isValidSignature` fonksiyonuna verir.
Coinbase Smart Wallet gibi hesaplar imzayı kendi sarmalayıcı biçiminde ve
replay-safe bir hash üzerinden beklediği için bu çağrı revert eder ve ödeme
`invalid_exact_evm_payload_signature` ile reddedilir. Canlı bir ödemede
gözlemlendi.

Bu yüzden Base MCP'yi bu endpoint'e ödeme yaptırmak için değil, cüzdan
işlemleri (bakiye, transfer, swap) için kullanın. Ödeme yapmak isteyen ajanlar
için `mcp-server/` paketi standart bir EOA hesabıyla çalışır.

Arayüzdeki Coinbase Wallet konnektörü bu nedenle `preference: 'eoaOnly'` ile
yapılandırıldı — kullanıcı akıllı cüzdana yönlendirilip başarısız bir ödemeye
sürüklenmesin.

### Bu projenin kendi MCP sunucusu

`mcp-server/` altındaki bağımsız paket, gözetimsiz senaryolar içindir: ödemeyi
kendi sıcak cüzdanından **onay sormadan** yapar. Otomasyon için uygundur, ama
anahtar riski size aittir — küçük bakiye tutun. Kurulum için
`mcp-server/README.md`.

Kısaca: insan varsa Base MCP, tam otomasyon gerekiyorsa yerel MCP sunucusu.

## Bazaar keşfi

`/api/premium`, 402 yanıtında `extensions.bazaar` metadata'sı yayımlar. Bu sayede
facilitator, ödeme settle edildikten sonra endpoint'i indeksleyebilir ve alıcılar
(ajanlar dahil) CDP'nin discovery API'lerinden bulabilir.

## Builder Code (ERC-8021)

402 yanıtına Schema 2'nin `a` (app) alanı eklenir ve facilitator bunu settlement
calldata'sına gömer — böylece bu endpoint'in Base üzerindeki ödemeleri
uygulamaya atfedilir. Proje kendi kodu (`bc_g6baqkul`) ile gelir; builder code
gizli bir değer değil, herkese açık atıf verisidir.

Bir fork'u kendi kodunuza atfetmek için `BUILDER_CODE` tanımlayın. Atfı tamamen
kapatmak için değişkeni boş bırakın (`BUILDER_CODE=`).

`a` alanı sunucu tarafına aittir: endpoint'i sunan taraf onu 402 yanıtında
bildirir. İstemci tarafındaki `BuilderCodeClientExtension` ise ayrı olan `s`
alanını doldurur ve başkasının endpoint'ine ödeme yaparken kendini atfeden
üçüncü taraflar içindir — bu proje kendi endpoint'ine sahip olduğu için `a`
doğru alandır.

## Ajan keşfi (A2A)

`/.well-known/agent-card.json`, servisi ve x402 ödeme gerekliliğini tanımlayan
A2A uyumlu bir kart döner. Kart, sabit bir adres yerine isteğin kendi origin'inden
üretilir (Vercel'in TLS sonlandırması için `x-forwarded-proto` dikkate alınır),
böylece dağıtım hiçbir zaman cevap vermediği bir URL'i duyurmaz.

## Endpoint doğrulama

Dağıtımdan sonra endpoint'i CDP'nin doğrulayıcısına karşı kontrol edin:

```bash
npm run validate -- https://<alan-adiniz>/api/premium
```

`reachable`, `returns_402`, `has_bazaar_extension` ve `parse` kontrollerini
raporlar. Ödeme yapmaz, kaynağı indekslemez ve CDP anahtarı gerektirmez; ancak
endpoint herkese açık HTTPS üzerinden erişilebilir olmalıdır (localhost olmaz).

## Protokol kaynağı

x402 protokolünün ve kullanılan `@x402/*` paketlerinin resmî deposu:
[x402-foundation/x402](https://github.com/x402-foundation/x402) (eski adresi
`coinbase/x402`; Coinbase protokolü x402 Foundation'a devretti). Spesifikasyonlar
`specs/`, referans sunucu örnekleri `examples/typescript/servers/` altında.

## Notlar

- Proje gerçek mainnet üzerinde çalışacak şekilde yapılandırılmıştır: gerçek USDC
  bakiyesi ve gas (ETH) gerektirir.
- x402 EIP-3009 ödemesi, imzadan çözümlenebilen bir EOA hesabı gerektirir; akıllı
  kontrat cüzdanları (ERC-1271/6492) facilitator tarafından reddedilebilir.
