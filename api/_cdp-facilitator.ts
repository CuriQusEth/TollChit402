import { HTTPFacilitatorClient } from "@x402/core/server";
import { generateJwt } from "@coinbase/cdp-sdk/auth";

/** Thrown when required environment configuration is absent. */
export class MissingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingConfigError";
  }
}

/** CDP facilitator base URL. */
export const CDP_FACILITATOR_URL =
  "https://api.cdp.coinbase.com/platform/v2/x402";

/**
 * Builds a CDP-authenticated x402 facilitator client.
 *
 * This mirrors `createCdpFacilitatorClient` from `@coinbase/cdp-sdk/x402`, which
 * cannot be imported directly: that entry point eagerly requires
 * `@x402/svm/exact/server`, so using it would mean installing the whole Solana
 * toolchain (73 packages) into a Base-only app. The JWT is still produced by the
 * SDK's own `auth` export, so no signing logic is reimplemented here — only the
 * wiring that binds a token to each operation's host and path.
 *
 * Credentials resolve from CDP_API_KEY_ID / CDP_API_KEY_SECRET.
 */
export function createCdpFacilitatorClient(): HTTPFacilitatorClient {
  const apiKeyId = process.env.CDP_API_KEY_ID;
  const apiKeySecret = process.env.CDP_API_KEY_SECRET;

  const missing = [
    !apiKeyId && "CDP_API_KEY_ID",
    !apiKeySecret && "CDP_API_KEY_SECRET",
  ].filter(Boolean);

  if (!apiKeyId || !apiKeySecret) {
    throw new MissingConfigError(
      `CDP kimlik bilgileri eksik: ${missing.join(", ")}. ` +
        "Bu değerleri .env dosyanıza ekleyin (`cp .env.example .env`)."
    );
  }

  // Overridable so a staging/canary facilitator — or a local stub in tests —
  // can be targeted. JWT signing derives host and paths from this URL, so it
  // stays correctly bound to whatever is configured.
  const baseUrl = process.env.CDP_FACILITATOR_BASE_URL || CDP_FACILITATOR_URL;
  const { host, pathname } = new URL(baseUrl);
  const basePath = pathname.replace(/\/$/, "");

  // Each operation is signed for its own path, so a token minted for /verify is
  // not accepted on /settle.
  const authHeadersFor = async (
    path: string,
    method: "POST" | "GET" = "POST"
  ) => ({
    Authorization: `Bearer ${await generateJwt({
      apiKeyId,
      apiKeySecret,
      requestMethod: method,
      requestHost: host,
      requestPath: path,
    })}`,
  });

  return new HTTPFacilitatorClient({
    url: baseUrl,
    createAuthHeaders: async () => {
      const [verify, settle, supported] = await Promise.all([
        authHeadersFor(`${basePath}/verify`),
        authHeadersFor(`${basePath}/settle`),
        authHeadersFor(`${basePath}/supported`, "GET"),
      ]);
      return { verify, settle, supported };
    },
  });
}
