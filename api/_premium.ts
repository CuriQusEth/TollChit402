import express, { type Router } from "express";
import {
  paymentMiddleware,
  setSettlementOverrides,
  x402ResourceServer,
} from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { UptoEvmScheme } from "@x402/evm/upto/server";
import type { Network } from "@x402/core/types";
import type { HTTPRequestContext } from "@x402/core/server";
import {
  BUILDER_CODE,
  builderCodeResourceServerExtension,
  declareBuilderCodeExtension,
  declareDiscoveryExtension,
} from "@x402/extensions";
import { TIERS, type Tier } from "../shared/tiers.js";
import { readStats, recordPayment } from "./_stats.js";
import {
  createCdpFacilitatorClient,
  MissingConfigError,
  missingEnvHint,
} from "./_cdp-facilitator.js";



/** Varsayılan paket; tarayıcı arayüzü ve MCP aracı bunu kullanır. */
export const PREMIUM_ROUTE = TIERS[0].route;

/** Ücretli uçların tamamı; router hangi yolun kapılı olduğunu buradan bilir. */
const PAID_ROUTES: readonly string[] = TIERS.map((t) => t.route);

/** `metered` ucunda birim başına ücret (6 haneli USDC atomik birimi). */
const METERED_UNIT_ATOMIC = 5000; // 0.005 USDC

/** Tavanı aşmamak için izin verilen en yüksek birim sayısı. */
const METERED_MAX_UNITS = 100; // 100 * 0.005 = 0.50 USDC

/** A2A agent discovery document. */
export const AGENT_CARD_ROUTE = "/.well-known/agent-card.json";

/** Read-only payment counters. */
export const STATS_ROUTE = "/api/stats";

/** Base mainnet, CAIP-2. The CDP facilitator settles `exact` payments here. */
export const BASE_NETWORK: Network = "eip155:8453";

/** Price per request, in the x402 `Money` form. */
export const PRICE = "$0.05";

/** Header the UI uses to name the wallet a payment should go to. */
export const RECIPIENT_HEADER = "x-payment-recipient";

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Wallet that receives the USDC for one request.
 *
 * The address is read from the request, so the panel in the UI decides where a
 * payment goes and no address has to be configured to run the app. Note what
 * this means: the payer chooses the recipient, so this is a demo of the payment
 * flow rather than a way to collect revenue — a visitor can simply name their
 * own wallet. Set PAYMENT_RECIPIENT_ADDRESS to pin every payment to one wallet
 * instead; it is also the fallback when the panel is left empty.
 */
export function pickPaymentRecipient(
  requested: string | undefined
): { address: string } | { error: string } {
  const fromPanel = requested?.trim();

  if (fromPanel) {
    return EVM_ADDRESS.test(fromPanel)
      ? { address: fromPanel }
      : {
          error: `Alıcı adresi geçersiz: "${fromPanel}". 0x ile başlayan 40 haneli bir EVM adresi olmalı.`,
        };
  }

  const configured = process.env.PAYMENT_RECIPIENT_ADDRESS?.trim();
  if (!configured) {
    return {
      error:
        "Alıcı adresi yok: paneldeki 'Recipient Address' alanını doldurun ya da " +
        "PAYMENT_RECIPIENT_ADDRESS tanımlayın. " +
        missingEnvHint(),
    };
  }
  return EVM_ADDRESS.test(configured)
    ? { address: configured }
    : {
        error: `PAYMENT_RECIPIENT_ADDRESS geçersiz: "${configured}". 0x ile başlayan 40 haneli bir EVM adresi olmalı.`,
      };
}

/**
 * The payTo the middleware asks for while building payment requirements.
 *
 * By this point the router has already validated the recipient and answered if
 * it was unusable, so a throw here would mean a bug rather than bad input —
 * @x402/express would swallow it into a bare "Internal Server Error".
 */
function resolvePaymentRecipient(context: HTTPRequestContext): string {
  const picked = pickPaymentRecipient(context.adapter.getHeader(RECIPIENT_HEADER));
  if ("error" in picked) throw new MissingConfigError(picked.error);
  return picked.address;
}

/**
 * This project's Base builder code. A builder code is public attribution data,
 * not a credential, so it lives in the repository as the default and only needs
 * BUILDER_CODE set to attribute a fork to someone else.
 */
const DEFAULT_BUILDER_CODE = "bc_g6baqkul";

/**
 * ERC-8021 app builder code, attributing settlements of this endpoint on Base.
 *
 * This is the `a` (app) field of Schema 2 — "the x402 service that exposed the
 * paid endpoint" — which is what this project is, since it owns the endpoint.
 * It is set by the server in the 402 response, not by the client: the client
 * side (`BuilderCodeClientExtension`) fills the separate `s` field, which is
 * for a third party attributing itself while paying someone else's endpoint.
 *
 * The facilitator combines this with its own code and encodes the suffix into
 * the settlement calldata, so nothing needs to be encoded here.
 */
function getBuilderCode(): string | undefined {
  // An explicitly empty BUILDER_CODE disables attribution; unset falls back to
  // this project's own code.
  const configured = process.env.BUILDER_CODE?.trim();
  const code = configured === undefined ? DEFAULT_BUILDER_CODE : configured;
  if (!code) return undefined;

  // Same constraint the extension schema enforces; failing early beats having
  // the facilitator reject the payment.
  if (!/^[a-z0-9_]{1,32}$/.test(code)) {
    throw new MissingConfigError(
      `BUILDER_CODE geçersiz: "${code}". 1-32 karakter, yalnızca küçük harf, rakam ve alt çizgi olmalı.`
    );
  }
  return code;
}

/** Route configuration for the paid endpoint. */
function routes() {
  const builderCode = getBuilderCode();
  const builderExtension = builderCode
    ? { [BUILDER_CODE]: declareBuilderCodeExtension(builderCode) }
    : {};

  return Object.fromEntries(
    TIERS.map((tier) => [
      // The verb prefix matters: a bare path is stored with verb "*", which
      // gates every method. Only GET is served, so without it a client could
      // pay for a POST and then get a 404.
      `GET ${tier.route}`,
      {
        accepts: [
          {
            scheme: tier.scheme,
            network: BASE_NETWORK,
            payTo: resolvePaymentRecipient,
            price: tier.price,
          },
        ],
        description: tier.description,
        mimeType: "application/json",
        serviceName: "x402-pay",
        tags: ["x402", "base", "usdc", tier.id],
        // Bazaar discovery metadata. Without this the endpoint still takes
        // payments, but the facilitator will not index it and CDP's
        // /v2/x402/validate reports has_bazaar_extension as failed.
        // The HTTP method is deliberately omitted: bazaarResourceServerExtension
        // fills it in from the route when it enriches the declaration.
        extensions: {
          ...builderExtension,
          ...declareDiscoveryExtension({
            // A fixed sample, not the live payload: the declaration is built
            // once, so a live timestamp would freeze into the published
            // discovery metadata and advertise a stale paidAt forever.
            output: { example: sampleFor(tier) },
          }),
        },
      },
    ])
  );
}

/** "$0.25" gibi bir fiyatı 6 haneli USDC atomik birimine çevirir. */
function priceToAtomic(price: string): number {
  return Math.round(Number(price.replace(/[^0-9.]/g, "")) * 1_000_000);
}

/** Keşif metadata'sına konan sabit örnek yanıt. */
function sampleFor(tier: Tier) {
  return {
    service: "x402-pay",
    tier: tier.id,
    network: BASE_NETWORK,
    price: tier.price,
    paidAt: "2026-01-01T00:00:00.000Z",
    message: "Ödeme doğrulandı ve Base üzerinde settle edildi.",
  };
}

/** The content served once a payment has been verified and settled. */
function premiumPayload(tier: Tier) {
  return {
    service: "x402-pay",
    tier: tier.id,
    network: BASE_NETWORK,
    price: tier.price,
    paidAt: new Date().toISOString(),
    message:
      "Ödeme doğrulandı ve Base üzerinde settle edildi. Bu içerik yalnızca ödeme sonrası döner.",
  };
}

/**
 * A2A agent card describing this service and its x402 payment requirement.
 *
 * Built from the same constants as the paid route and from the request's own
 * origin rather than a hard-coded host, so a deployment never advertises a URL
 * it does not answer on.
 */
function agentCard(origin: string) {
  return {
    name: "x402 Pay Gateway",
    description:
      "Base Mainnet üzerinde x402 protokolü (EIP-3009 'exact' şeması) ile USDC mikro ödemesi karşılığında erişilen demo endpoint.",
    version: "2.0.0",
    url: `${origin}${PREMIUM_ROUTE}`,
    provider: {
      organization: "x402 Development Group",
      url: origin,
    },
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    supportedInterfaces: [
      {
        url: `${origin}${PREMIUM_ROUTE}`,
        protocolBinding: "HTTP+x402",
        protocolVersion: "2",
      },
    ],
    // Her paket ayrı bir beceri olarak duyurulur; ajan hangi ucun ne kadara
    // mal olduğunu kartı okuyarak görebilsin.
    skills: TIERS.map((tier) => ({
      id: tier.id,
      name: `x402 ${tier.label}`,
      description: tier.description,
      tags: ["x402", "base", "usdc", "payment-required", tier.id],
      examples: [
        tier.scheme === "upto"
          ? `GET ${tier.route}?units=10`
          : `GET ${tier.route}`,
      ],
    })),
    security: [
      {
        x402: {
          scheme: "exact",
          network: BASE_NETWORK,
          asset: "USDC",
          description:
            "Bu endpoint HTTP 402 Payment Required döner; istemcinin EIP-3009 imzalı bir yetkilendirme ile tekrar istek göndermesi gerekir.",
        },
      },
    ],
  };
}

/**
 * Builds the router that serves the paid endpoint.
 *
 * Both the local Express server and the Vercel function mount this same router,
 * so the two environments run identical code rather than parallel
 * implementations that can drift apart.
 *
 * The facilitator client is created lazily on the first request to the paid
 * route: constructing it throws when credentials are absent, and that must
 * surface as a 500 on that route rather than stopping the app from starting or
 * breaking unrelated routes.
 */
export function createPremiumRouter(): Router {
  const router = express.Router();

  let pending: Promise<ReturnType<typeof paymentMiddleware>> | null = null;

  /**
   * Builds the payment middleware once, on the first request to the paid route.
   *
   * The facilitator sync is run here rather than left to the middleware so its
   * failure can be reported with the underlying cause: `@x402/express` answers
   * its own errors with a bare "Internal Server Error". A failed attempt is not
   * cached, so a transient facilitator outage is retried on the next request
   * instead of disabling the endpoint for the process lifetime.
   */
  const getPaymentMiddleware = () => {
    if (!pending) {
      pending = (async () => {
        const server = new x402ResourceServer(createCdpFacilitatorClient())
          .register(BASE_NETWORK, new ExactEvmScheme())
          // The metered tier settles through the upto scheme, so its server
          // implementation has to be registered too; without it the route's
          // payment option is dropped and the 402 advertises an empty accepts.
          .register(BASE_NETWORK, new UptoEvmScheme())
          // Enriches the route's bazaar declaration and lets the facilitator
          // index this resource after a settlement.
          // bazaarResourceServerExtension is not registered here: the express
          // adapter registers it itself whenever a route declares the bazaar
          // extension, and registering it twice is pointless.
          .registerExtension(builderCodeResourceServerExtension);

        // Payment requirements cannot be built until the facilitator has
        // reported which scheme/network pairs it supports.
        await server.initialize();

        return paymentMiddleware(routes(), server, undefined, undefined, false);
      })().catch((err) => {
        pending = null;
        throw err;
      });
    }
    return pending;
  };

  router.use(async (req, res, next) => {
    // Only the paid route is gated. The SPA and its assets must keep working
    // even when CDP credentials are absent or the facilitator is unreachable.
    if (!PAID_ROUTES.includes(req.path)) return next();

    const recipient = pickPaymentRecipient(req.header(RECIPIENT_HEADER));
    if ("error" in recipient) {
      res.status(400).json({ error: "invalid_recipient", message: recipient.error });
      return;
    }

    let paid: ReturnType<typeof paymentMiddleware>;
    try {
      paid = await getPaymentMiddleware();
    } catch (err) {
      // A missing key is the operator's to fix (500); anything else means the
      // facilitator itself could not be reached or agreed with (502).
      const misconfigured = err instanceof MissingConfigError;
      console.error("[x402] Ödeme katmanı hazırlanamadı:", err);
      res.status(misconfigured ? 500 : 502).json({
        error: misconfigured ? "server_misconfigured" : "facilitator_unavailable",
        message: (err as Error).message,
      });
      return;
    }

    // Express 4 does not forward a rejected promise to the error handler, so the
    // rejection is routed explicitly.
    return Promise.resolve(paid(req, res, next)).catch(next);
  });

  for (const tier of TIERS) {
    router.get(tier.route, (req, res) => {
      if (tier.scheme !== "upto") {
        // Bu noktaya yalnızca ödeme middleware'i doğrulamayı geçirdiyse
        // gelinir, yani sayılan şey gerçekten ödenmiş bir istektir.
        void recordPayment(priceToAtomic(tier.price));
        res.json(premiumPayload(tier));
        return;
      }

      // upto: istemci tavanı yetkilendirdi, gerçek tutarı burada belirliyoruz.
      // Talep edilen birim sayısı tavanı aşamaz, yoksa facilitator settlement'ı
      // reddeder — bu yüzden kırpılıyor.
      const requested = Number.parseInt(String(req.query.units ?? "1"), 10);
      const units = Number.isFinite(requested)
        ? Math.min(Math.max(requested, 1), METERED_MAX_UNITS)
        : 1;
      const chargedAtomic = units * METERED_UNIT_ATOMIC;

      // Bu, settlement anındaki PaymentRequirements.amount alanını geçersiz
      // kılar: zincire yazılan gerçek tahsilat budur, yetkilendirilen tavan
      // değil.
      setSettlementOverrides(res, { amount: String(chargedAtomic) });

      // Tavan değil, gerçekte tahsil edilen tutar sayılır.
      void recordPayment(chargedAtomic);

      res.json({
        ...premiumPayload(tier),
        usage: {
          units,
          unitPriceAtomic: String(METERED_UNIT_ATOMIC),
          authorizedMaxAtomic: String(METERED_MAX_UNITS * METERED_UNIT_ATOMIC),
          chargedAtomic: String(chargedAtomic),
        },
      });
    });
  }

  router.get(STATS_ROUTE, async (_req, res) => {
    res.json(await readStats());
  });

  router.get(AGENT_CARD_ROUTE, (req, res) => {
    // x-forwarded-proto is what tells us the scheme behind Vercel's TLS
    // termination; req.protocol alone would report http there.
    const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
    res.json(agentCard(`${proto}://${req.get("host")}`));
  });

  return router;
}
