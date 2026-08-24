// Paket tablosu — sunucu ve tarayıcı tarafı aynı kaynaktan okur.
//
// Bu dosya bilerek bağımlılıksızdır: api/ tarafı express ve CDP SDK'sını
// çeker, o zincir tarayıcı paketine girmemeli.

/**
 * Paket tablosu.
 *
 * `exact` paketleri sabit fiyatlıdır. `metered` ise `upto` şemasını kullanır:
 * istemci bir tavan yetkilendirir, sunucu gerçekte kullanılan tutarı settle
 * eder — kullanım bazlı fiyatlandırma bu şekilde yapılır.
 */
export const TIERS = [
  {
    id: "basic",
    route: "/api/premium",
    scheme: "exact",
    price: "$0.05",
    label: "Basic",
    description:
      "Base mainnet üzerinde x402 ile ödenen demo endpoint; ödeme doğrulandıktan sonra JSON döner.",
  },
  {
    id: "pro",
    route: "/api/premium/pro",
    scheme: "exact",
    price: "$0.25",
    label: "Pro",
    description:
      "Genişletilmiş demo yanıtı: ödeme ayrıntıları ve paket bilgisiyle birlikte döner.",
  },
  {
    id: "metered",
    route: "/api/premium/metered",
    scheme: "upto",
    price: "$0.50",
    label: "Metered",
    description:
      "Kullanım bazlı uç: ?units= ile birim sayısı verilir, tavana kadar yalnızca kullanılan tutar tahsil edilir.",
  },
] as const;

export type Tier = (typeof TIERS)[number];
export type TierId = Tier["id"];
