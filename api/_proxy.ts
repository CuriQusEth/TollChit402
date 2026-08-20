/**
 * Shared proxy helpers. Files prefixed with "_" are not treated as
 * serverless routes by Vercel, so this module is safe to keep in api/.
 */

/**
 * Hop-by-hop headers are meaningful only for a single transport connection
 * (RFC 9110 §7.6.1) and must not be forwarded by a proxy.
 *
 * Forwarding `transfer-encoding: chunked` was corrupting responses: the header
 * was copied from the upstream response while the body was piped through, so
 * the runtime chunk-encoded an already chunk-encoded payload. `content-length`
 * is dropped as well because it no longer describes what we emit once the body
 * is re-framed; the runtime sets the correct framing itself.
 *
 * `content-encoding` is deliberately kept: the upstream body is piped through
 * verbatim (still gzip/br compressed), so the client needs it to decode.
 */
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
]);

/**
 * Copies upstream response headers onto the outgoing response, skipping
 * hop-by-hop headers.
 */
export function copyResponseHeaders(
  upstreamHeaders: Record<string, string | string[] | undefined>,
  setHeader: (key: string, value: string | string[]) => void
): void {
  for (const [key, value] of Object.entries(upstreamHeaders)) {
    if (value === undefined) continue;
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    setHeader(key, value);
  }
}
