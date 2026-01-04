// app/utils/request-id.server.ts
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export const REQUEST_ID_HEADER = "X-Request-Id";
export const REQUEST_ID_ALIAS_HEADER = "X-Correlation-Id";

type RequestContext = { requestId: string };

const als = new AsyncLocalStorage<RequestContext>();

export function getRequestId(): string | undefined {
  return als.getStore()?.requestId;
}

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return als.run({ requestId }, fn);
}

/**
 * Sanitize inbound request id:
 * - trims
 * - strips optional surrounding braces: {uuid}
 * - caps length
 * - allows: A–Z a–z 0–9 . _ -
 *   (good for UUIDs, nanoid-like ids, trace ids like 00-...-...-01)
 */
export function sanitizeInboundRequestId(raw: string | null): string | undefined {
  if (!raw) return undefined;
  let v = raw.trim();
  if (!v) return undefined;

  // strip { ... } wrappers (some systems send UUIDs like {uuid})
  if (v.startsWith("{") && v.endsWith("}") && v.length > 2) {
    v = v.slice(1, -1).trim();
  }

  // cap length to prevent abuse / log explosion
  if (v.length > 128) return undefined;

  // conservative allowed chars: dot/underscore/dash only
  if (!/^[A-Za-z0-9._-]+$/.test(v)) return undefined;

  return v;
}

/**
 * Headers.get() is case-insensitive.
 * Priority: X-Request-Id > X-Correlation-Id
 */
export function getOrCreateRequestId(headers: Headers): string {
  const inbound =
    sanitizeInboundRequestId(headers.get(REQUEST_ID_HEADER)) ??
    sanitizeInboundRequestId(headers.get(REQUEST_ID_ALIAS_HEADER));

  return inbound ?? randomUUID();
}

/**
 * Set X-Request-Id on a Headers object (useful when your handler already builds headers).
 */
export function setRequestIdHeader(headers: Headers, requestId: string): void {
  headers.set(REQUEST_ID_HEADER, requestId);
}

/**
 * Immutable response wrapper for cases where you already have a Response.
 * Safe for streaming bodies.
 */
export function withRequestIdHeader(response: Response, requestId: string): Response {
  const newHeaders = new Headers(response.headers);
  newHeaders.set(REQUEST_ID_HEADER, requestId);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

/**
 * Global fetch patching (restorable + idempotent).
 * Adds X-Request-Id to outbound requests unless already present.
 */
let restoreFetchPatch: (() => void) | undefined;

export function enableFetchRequestIdPropagation(): () => void {
  if (restoreFetchPatch) return restoreFetchPatch;

  // bind to preserve `this` in some runtimes
  const originalFetch: typeof fetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const rid = getRequestId();
    if (!rid) return originalFetch(input, init);

    // Build a base request so we can safely merge headers
    const baseRequest = input instanceof Request ? input : new Request(input, init);

    const headers = new Headers(baseRequest.headers);

    // Headers are case-insensitive; checking `.has("X-Request-Id")` is enough.
    // We keep this explicit and only set when absent.
    if (!headers.has(REQUEST_ID_HEADER)) {
      headers.set(REQUEST_ID_HEADER, rid);
    }

    // Merge init over baseRequest but ensure our merged headers win.
    // If input was a Request, new Request(baseRequest, init) won't merge headers automatically,
    // so we pass our merged headers explicitly.
    const nextRequest = new Request(baseRequest, {
      ...init,
      headers,
    });

    return originalFetch(nextRequest);
  };

  restoreFetchPatch = () => {
    globalThis.fetch = originalFetch;
    restoreFetchPatch = undefined;
  };

  return restoreFetchPatch;
}

/**
 * Convenience for server startup: currently only patches fetch.
 * (We intentionally do NOT patch console to avoid breaking structured logs.)
 */
export function enableRequestIdRuntimePatches(): () => void {
  return enableFetchRequestIdPropagation();
}

/**
 * Wrap any loader/action/webhook handler so:
 * - requestId is reused or generated
 * - AsyncLocalStorage context is set for the whole function
 * - logger.* can pick up requestId via getRequestId()
 */
export async function withRequestId<T>(
  request: Request,
  fn: (requestId: string) => Promise<T> | T
): Promise<T> {
  // Ensure fetch patch is enabled everywhere we use request IDs (idempotent)
  enableRequestIdRuntimePatches();

  const requestId = getOrCreateRequestId(request.headers);
  return await runWithRequestId(requestId, () => fn(requestId));
}

