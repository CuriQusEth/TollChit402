import express, { type Router } from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import type { Network } from "@x402/core/types";
import {
  BUILDER_CODE,
  builderCodeResourceServerExtension,
  declareBuilderCodeExtension,
  declareDiscoveryExtension,
} from "@x402/extensions";
import { createCdpFacilitatorClient, MissingConfigError } from "./_cdp-facilitator";

/** Path of the x402-protected endpoint. */
export const PREMIUM_ROUTE = "/api/premium";

/** A2A agent discovery document. */
export const AGENT_CARD_ROUTE = "/.well-known/agent-card.json";

/** Base mainnet, CAIP-2. The CDP facilitator settles `exact` payments here. */
export const BASE_NETWORK: Network = "eip155:8453";

/** Price per request, in the x402 `Money` form. */
export const PRICE = "$0.05";

/**
 * Wallet that receives the USDC. Kept in the environment so no address is
 * baked into the repository.
 */
function getPaymentRecipient(): string {
  const payTo = process.env.PAYMENT_RECIPIENT_ADDRESS;
  if (!payTo) {
    throw new MissingConfigError(
      "PAYMENT_RECIPIENT_ADDRESS tanımlı değil. Ödemelerin gideceği Base adresini .env dosyasına ekleyin."
    );
  }
  return payTo;
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
  return {
    // The verb prefix matters: a bare path is stored with verb "*", which gates
    // every method. Only GET is served, so without it a client could pay for a
    // POST and then get a 404.
    [`GET ${PREMIUM_ROUTE}`]: {
      accepts: [
        {
          scheme: "exact",
          network: BASE_NETWORK,
          payTo: getPaymentRecipient(),
          price: PRICE,
        },
      ],
      description:
        "Base mainnet üzerinde x402 ile ödenen demo endpoint; ödeme doğrulandıktan sonra JSON döner.",
      mimeType: "application/json",
      serviceName: "x402-pay",
      tags: ["x402", "base", "usdc", "demo"],
      // Bazaar discovery metadata. Without this the endpoint still takes
      // payments, but the facilitator will not index it and CDP's
      // /v2/x402/validate reports has_bazaar_extension as failed.
      // The HTTP method is deliberately omitted: bazaarResourceServerExtension
      // fills it in from the route when it enriches the declaration.
      extensions: {
        ...(builderCode
          ? { [BUILDER_CODE]: declareBuilderCodeExtension(builderCode) }
          : {}),
        ...declareDiscoveryExtension({
        // A fixed sample, not premiumPayload(): the declaration is built once,
        // so a live timestamp would freeze into the published discovery
        // metadata and advertise a stale paidAt forever.
        output: {
          example: {
            service: "x402-pay",
            network: BASE_NETWORK,
            price: PRICE,
            paidAt: "2026-01-01T00:00:00.000Z",
            message: "Ödeme doğrulandı ve Base üzerinde settle edildi.",
          },
        },
        }),
      },
    },
  };
}

/** The content served once a payment has been verified and settled. */
function premiumPayload() {
  return {
    service: "x402-pay",
    network: BASE_NETWORK,
    price: PRICE,
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
    skills: [
      {
        id: "premium-demo",
        name: "x402 Demo Endpoint",
        description: `Ödeme doğrulandıktan sonra JSON döner. x402 ile ödeme gerektirir (${PRICE}, Base Mainnet, EIP-3009 'exact' şeması).`,
        tags: ["x402", "base", "usdc", "payment-required"],
        examples: [`GET ${PREMIUM_ROUTE}`],
      },
    ],
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
    if (req.path !== PREMIUM_ROUTE) return next();

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

  router.get(PREMIUM_ROUTE, (_req, res) => {
    res.json(premiumPayload());
  });

  router.get(AGENT_CARD_ROUTE, (req, res) => {
    // x-forwarded-proto is what tells us the scheme behind Vercel's TLS
    // termination; req.protocol alone would report http there.
    const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
    res.json(agentCard(`${proto}://${req.get("host")}`));
  });

  return router;
}
