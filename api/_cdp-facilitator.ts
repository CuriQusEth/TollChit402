import { HTTPFacilitatorClient } from "@x402/core/server";
import { generateJwt } from "@coinbase/cdp-sdk/auth";

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

/** Bare key id, the form the CDP portal shows for newer keys. */
const PLAIN_KEY_ID = new RegExp(`^${UUID}$`);

/** Canonical full form: organizations/{org}/apiKeys/{key}. */
const FULL_KEY_ID = new RegExp(`^organizations/${UUID}/apiKeys/${UUID}$`);

/**
 * Same shape as the full form but with either label replaced.
 *
 * The CDP portal translates its labels, so a browser set to another language
 * yields e.g. "kuruluşlar/{org}/apiKeys/{key}". The SDK does not validate the
 * id — it signs whatever it is given into the JWT `sub` — so a translated value
 * fails later as an opaque authentication error. Two UUIDs in a four-segment
 * path is unmistakable, so the labels are restored rather than rejected.
 */
const LOCALISED_KEY_ID = new RegExp(`^[^/]+/(${UUID})/[^/]+/(${UUID})$`);

/**
 * Normalises CDP_API_KEY_ID to a form the CDP API accepts.
 *
 * @param raw - The configured value.
 * @returns The canonical key id.
 */
function normaliseApiKeyId(raw: string): string {
  if (PLAIN_KEY_ID.test(raw) || FULL_KEY_ID.test(raw)) return raw;

  const localised = raw.match(LOCALISED_KEY_ID);
  if (localised) {
    const canonical = `organizations/${localised[1]}/apiKeys/${localised[2]}`;
    console.warn(
      `[cdp] CDP_API_KEY_ID yerelleştirilmiş etiketler içeriyordu ("${raw.split("/")[0]}/…"). ` +
        "CDP portalı tarayıcı diline göre etiketleri çeviriyor; değer " +
        "organizations/…/apiKeys/… biçimine düzeltildi."
    );
    return canonical;
  }

  throw new MissingConfigError(
    `CDP_API_KEY_ID biçimi tanınmadı: "${raw}". Beklenen biçim ` +
      "organizations/<org-uuid>/apiKeys/<key-uuid> ya da yalnızca <key-uuid>."
  );
}

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
  const keyId = normaliseApiKeyId(apiKeyId);

  const { host, pathname } = new URL(baseUrl);
  const basePath = pathname.replace(/\/$/, "");

  // Each operation is signed for its own path, so a token minted for /verify is
  // not accepted on /settle.
  const authHeadersFor = async (
    path: string,
    method: "POST" | "GET" = "POST"
  ) => ({
    Authorization: `Bearer ${await generateJwt({
      apiKeyId: keyId,
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
