// app/utils/logger.server.ts
import { getRequestId } from "./request-id.server";

type Level = "debug" | "info" | "warn" | "error";

// AS-136 schema
export type EventType =
  | "oauth_start"
  | "oauth_callback"
  | "session_exchange"
  | "webhook_uninstall"
  | "webhook_other";

export type Outcome = "success" | "failure";

export type EventMetadata = {
  eventType: EventType;
  outcome: Outcome;

  merchantId?: string;
  shopDomain?: string;

  durationMs?: number;
  status?: number;
  topic?: string;
  webhookId?: string;

  errorName?: string;
  errorMessage?: string;

  // allow extra keys, but we sanitize/redact
  [k: string]: unknown;
};

function toUpperLevel(level: Level): "DEBUG" | "INFO" | "WARN" | "ERROR" {
  switch (level) {
    case "debug":
      return "DEBUG";
    case "info":
      return "INFO";
    case "warn":
      return "WARN";
    case "error":
      return "ERROR";
  }
}

const REDACTED = "[REDACTED]";
const OMITTED = "[OMITTED]";

/**
 * Allowlist keys that should remain visible (NOT PII / NOT secrets).
 * We still sanitize their VALUES (so accidental tokens under these keys get redacted),
 * but we never redact them just because of the key name.
 */
const ALLOW_KEYS = new Set<string>([
  "shop",
  "shopdomain",
  "shop_domain",
  "merchantid",
  "requestid",
  "eventtype",
  "outcome",
]);

/**
 * Keys that must never be logged (case-insensitive).
 * Includes tokens, OAuth params, signatures, secrets, and basic PII fields.
 * Also blocks bodies/payloads by default (no raw request bodies in prod logs).
 */
const SENSITIVE_KEY_RE =
  /^(?:.*)(token|access[_-]?token|refresh[_-]?token|authorization|bearer|jwt|id[_-]?token|client[_-]?secret|secret|api[_-]?key|private[_-]?key|encryption[_-]?key|hmac|signature|code|state|email|phone|address|password|payload|rawBody|requestBody|body)(?:.*)$/i;

// token-ish patterns (defense in depth)
const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const SHOPIFY_TOKEN_PREFIX_RE = /(shpat_|shpua_|shpca_|shpss_|shppa_)/i;
const BEARER_RE = /^Bearer\s+/i;
const LONG_OPAQUE_RE = /^[A-Za-z0-9+/=_-]{32,}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


/**
 * Heuristic: avoid false-positive JWT redaction for normal 3-part dotted strings like:
 * - astra-chat-dev.myshopify.com
 * - heard-collectible-undertaken-weather.trycloudflare.com
 *
 * A real JWT signature (3rd segment) is typically long and base64url-ish.
 * A domain "TLD" segment is short and alphabetic (com, net, org, io, etc.).
 */
function isLikelyJwtTripleSegment(s: string): boolean {
  if (!JWT_RE.test(s)) return false;

  const parts = s.split(".");
  if (parts.length !== 3) return false;

  const third = parts[2] ?? "";

  // If the 3rd segment looks like a TLD (short, letters only), treat as domain, NOT JWT.
  if (/^[A-Za-z]{2,10}$/.test(third)) return false;

  // If the 3rd segment is short, it's not a realistic JWT signature.
  if (third.length < 12) return false;

  return true;
}

/** Scrub common secret-bearing substrings inside strings */
function scrubString(s: string): string {
  return s
    .replace(/(bearer\s+)[^\s,]+/gi, `$1${REDACTED}`)
    .replace(/(authorization[:\s]+)[^\s,]+/gi, `$1${REDACTED}`)
    .replace(/(token[:\s=]+)[^\s,&]+/gi, `$1${REDACTED}`)
    .replace(/(access[_-]?token[:\s=]+)[^\s,&]+/gi, `$1${REDACTED}`)
    .replace(/(refresh[_-]?token[:\s=]+)[^\s,&]+/gi, `$1${REDACTED}`)
    .replace(/(hmac[:\s=]+)[^\s,&]+/gi, `$1${REDACTED}`)
    .replace(/(code=)[^&\s]+/gi, `$1${REDACTED}`)
    .replace(/(state=)[^&\s]+/gi, `$1${REDACTED}`);
}

function redactTokenishString(s: string): string {
  if (BEARER_RE.test(s)) return `Bearer ${REDACTED}`;
  if (isLikelyJwtTripleSegment(s)) return REDACTED;
  if (SHOPIFY_TOKEN_PREFIX_RE.test(s)) return REDACTED;

  // ✅ allow UUIDs like x-shopify-webhook-id (not PII, not a token)
  if (UUID_RE.test(s)) return s;

  if (LONG_OPAQUE_RE.test(s)) return REDACTED;
  return s;
}


/**
 * Message redaction MUST be more conservative than value redaction.
 * Otherwise event names like "embedded.auth.start" look like JWTs and get redacted.
 *
 * We still redact obvious secrets in messages:
 * - Bearer tokens
 * - Shopify token prefixes
 * - Long opaque blobs
 * - JWT-like strings ONLY if they are "likely" real tokens (length threshold)
 */
function redactLogMessage(message: string): string {
  const scrubbed = scrubString(message);

  if (BEARER_RE.test(scrubbed)) return `Bearer ${REDACTED}`;
  if (SHOPIFY_TOKEN_PREFIX_RE.test(scrubbed)) return REDACTED;
  if (LONG_OPAQUE_RE.test(scrubbed)) return REDACTED;

  // Only treat 3-part dotted strings as JWTs if they are plausibly token-length.
  // Keeps "embedded.auth.start" readable while still protecting real JWTs.
  if (JWT_RE.test(scrubbed) && scrubbed.length >= 30) return REDACTED;

  return scrubbed;
}

function sanitizeValue(v: unknown): unknown {
  if (typeof v === "string") {
    const scrubbed = scrubString(v);
    return redactTokenishString(scrubbed);
  }
  return v;
}

function sanitizeMeta(input: unknown, depth = 0): unknown {
  if (depth > 6) return "[Truncated]";
  if (input == null) return input;

  if (Array.isArray(input)) {
    return input.slice(0, 50).map((x) => sanitizeMeta(x, depth + 1));
  }

  if (typeof input === "object") {
    const obj = input as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    let count = 0;

    for (const [k, v] of Object.entries(obj)) {
      count++;
      if (count > 100) {
        out.__truncated__ = true;
        break;
      }

      const nk = k.toLowerCase();

      // ✅ Allowlist: never redact these keys by name (but still sanitize their values)
      if (ALLOW_KEYS.has(nk)) {
        out[k] = sanitizeMeta(sanitizeValue(v), depth + 1);
        continue;
      }

      if (SENSITIVE_KEY_RE.test(k)) {
        // bodies/payloads are omitted, everything else redacted
        out[k] = /payload|rawBody|requestBody|body/i.test(k) ? OMITTED : REDACTED;
        continue;
      }

      out[k] = sanitizeMeta(sanitizeValue(v), depth + 1);
    }

    return out;
  }

  return sanitizeValue(input);
}

function emit(level: Level, message: string, meta?: Record<string, unknown>) {
  const sev = toUpperLevel(level);

  const safeMeta = (sanitizeMeta(meta ?? {}) as Record<string, unknown>) ?? {};

  // ✅ FIX: do NOT run JWT-style redaction on normal message strings
  const safeMessage = redactLogMessage(message);

  // Ensure errorMessage is scrubbed even if passed in
  if (typeof safeMeta.errorMessage === "string") {
    safeMeta.errorMessage = redactTokenishString(scrubString(safeMeta.errorMessage));
  }

  const payload = {
    timestamp: new Date().toISOString(),
    level: sev, // AC field
    severity: sev, // Cloud Logging friendliness
    message: safeMessage,
    requestId: getRequestId() ?? "missing-request-id",
    ...safeMeta,
  };

  const line = JSON.stringify(payload);

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (level === "debug") console.debug(line);
  else console.log(line);
}

// keep existing API (no refactor churn)
export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit("error", msg, meta),
};

// --- AS-136 helpers ---

export function logEvent(message: string, meta: EventMetadata) {
  const level: Level = meta.outcome === "failure" ? "error" : "info";
  emit(level, message, meta);
}

export async function withEventLogging<T>(args: {
  eventType: EventType;
  message: string;
  shopDomain?: string;
  merchantId?: string;
  run: () => Promise<T>;
}): Promise<T> {
  const start = Date.now();

  try {
    const result = await args.run();

    logEvent(args.message, {
      eventType: args.eventType,
      shopDomain: args.shopDomain,
      merchantId: args.merchantId,
      outcome: "success",
      durationMs: Date.now() - start,
    });

    return result;
  } catch (err: unknown) {
    if (err instanceof Response && [301, 302, 303, 307, 308].includes(err.status)) {
      logEvent(args.message, {
        eventType: args.eventType,
        shopDomain: args.shopDomain,
        merchantId: args.merchantId,
        outcome: "success",
        durationMs: Date.now() - start,
        status: err.status,
        redirect: true,
      });
      throw err;
    } 

    logEvent(args.message, {
      eventType: args.eventType,
      shopDomain: args.shopDomain,
      merchantId: args.merchantId,
      outcome: "failure",
      durationMs: Date.now() - start,
      errorName: err instanceof Error ? err.name : "Error",
      errorMessage: err instanceof Error ? err.message : String(err),
    });

    throw err;
  }
}

