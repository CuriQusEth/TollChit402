/**
 * BaseGM kontratının arayüzü.
 *
 * TollChit402'nin tersine bu kontrat ücretsiz ve herkese açık: ödeme ya da
 * kimlik doğrulama istemiyor, `onlyOwner` bir kısmı yok. Herkes günde bir kez
 * `gm()` çağırabiliyor; ardışık günlerde çağıran serisini büyütüyor, gün
 * atlayan sıfırlanıyor.
 *
 * DİKKAT — GAZI KULLANICI ÖDER. x402 ödemesi alıcı için gazsızdır (EIP-3009,
 * gazı facilitator öder); `gm()` ise cüzdandan gönderilen sıradan bir işlem ve
 * gazını çağıran öder. Arayüz bunu açıkça söylemeli.
 */
export const GM_ABI = [
  {
    type: "function",
    name: "gm",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "currentStreak",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "hasSaidGmToday",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "totalGMs",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    // Aynı gün ikinci çağrı bu hatayla döner. ABI'de tanımlı olması, viem'in
    // çıplak seçici yerine adı göstermesini sağlıyor.
    type: "error",
    name: "AlreadySaidGmToday",
    inputs: [],
  },
] as const;

/**
 * Base mainnet'e dağıtılmış BaseGM kontratı.
 *
 * Kontrat adresi gizli bilgi değil, herkese açık zincir verisi — builder code
 * gibi doğrudan depoda duruyor. Bir fork kendi kontratını dağıttıysa burayı
 * değiştirmesi yeterli.
 */
export const GM_CONTRACT = "0x3C7b0F6ba861De9d43c1Bd083005aa64949c0Cf3" as const;
