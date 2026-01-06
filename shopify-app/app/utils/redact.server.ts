// app/utils/redact.server.ts
//
// Pure helpers only — MUST NOT import logger (prevents circular deps).
//
// Exports:
// - redactForLogs(meta): deep redaction for meta objects
// - redactString(value): redaction for arbitrary string values (aggressive)
// - redactLogMessage(message): conservative redaction for log "message" field
// - sanitizeErrorMessage(message): strong scrubbing for errorMessage strings

const REDACTED = "[REDACTED]";
const OMITTED = "[OMITTED]";

// Keys we explicitly allow (case-insensitive). These should remain visible for ops/debugging.
// We still sanitize values (so if someone accidentally passes a token under `shop`, it gets redacted).
const ALLOW_KEYS = new Set<string>([
  // shop identifiers (NOT PII)
  "shop",
  "shopdomain",
  "shop_domain",

  // correlation / schema keys
  "merchantid",
  "requestid",
  "eventtype",
  "outcome",
]);

// Keys that must never be logged (case-insensitive).
// NOTE: intentionally does NOT include "shop" or "shopDomain".
const SENSITIVE_KEY_RE =
  /^(?:.*)(token|access[_-]?token|refresh[_-]?token|authorization|bearer|jwt|id[_-]?token|client[_-]?secret|secret|api[_-]?key|private[_-]?key|encryption[_-]?key|hmac|signature|code|state|password|email|phone|address|ssn|dob)(?:.*)$/i;

// Body/payload-like keys should be omitted entirely (no raw bodies in prod logs).
const BODY_KEY_RE = /^(?:.*)(payload|rawbody|requestbody|body)(?:.*)$/i;

// Token-ish patterns (defense in depth).
const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const SHOPIFY_TOKEN_PREFIX_RE = /(shpat_|shpss_|shpua_|shpca_|shppa_)/i;
const BEARER_PREFIX_RE = /^Bearer\s+/i;
// Treat long opaque blobs as suspicious (your tests expect 40 "a"s to be redacted).
const LONG_OPAQUE_RE = /^[A-Za-z0-9+/=_-]{32,}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


/**
 * Heuristic: avoid false-positive JWT redaction for normal 3-part dotted strings like:
 * - astra-chat-dev.myshopify.com
 * - embedded.auth.start
 *
 * Real JWT signature segments are typically long; TLD-ish / word-ish third segments are short alphabetic.
 */
function isLikelyJwtTripleSegment(s: string): boolean {
  if (!JWT_RE.test(s)) return false;

  const parts = s.split(".");
  if (parts.length !== 3) return false;

  const third = parts[2] ?? "";

  // TLD-ish / word-ish third segment => treat as non-JWT (domain/event key), keep visible
  if (/^[A-Za-z]{2,10}$/.test(third)) return false;

  // Too short to be a realistic JWT signature
  if (third.length < 12) return false;

  return true;
}

function scrubCommonSubstrings(s: string): string {
  // Scrub query-string style oauth params & common headers
  let out = s
    .replace(/(bearer\s+)[^\s,]+/gi, `$1${REDACTED}`)
    .replace(/(authorization[:\s]+)[^\s,]+/gi, `$1${REDACTED}`)
    .replace(/(token[:\s=]+)[^\s,&]+/gi, `$1${REDACTED}`)
    .replace(/(access[_-]?token[:\s=]+)[^\s,&]+/gi, `$1${REDACTED}`)
    .replace(/(refresh[_-]?token[:\s=]+)[^\s,&]+/gi, `$1${REDACTED}`)
    .replace(/(hmac[:\s=]+)[^\s,&]+/gi, `$1${REDACTED}`)
    .replace(/(code=)[^&\s]+/gi, `$1${REDACTED}`)
    .replace(/(state=)[^&\s]+/gi, `$1${REDACTED}`);

  // Extra safety: scrub emails/phones if they appear inside strings
  // (Acceptance wants no PII in logs; key-based redaction handles most cases already.)
  out = out.replace(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    REDACTED
  );
  // Simple phone-like patterns (not perfect, but helpful)
  out = out.replace(/\+?\d[\d\s().-]{7,}\d/g, REDACTED);

  return out;
}

/**
 * Aggressive redaction for arbitrary string values in meta.
 * This is what keeps your tests passing for token-like values.
 */
export function redactString(value: string): string {
  const scrubbed = scrubCommonSubstrings(value);

  if (BEARER_PREFIX_RE.test(scrubbed)) return `Bearer ${REDACTED}`;
  if (isLikelyJwtTripleSegment(scrubbed)) return REDACTED;
  if (SHOPIFY_TOKEN_PREFIX_RE.test(scrubbed)) return REDACTED;

  // ✅ allow UUIDs (webhook ids, request ids, etc.)
  if (UUID_RE.test(scrubbed)) return scrubbed;

  if (LONG_OPAQUE_RE.test(scrubbed)) return REDACTED;

  return scrubbed;
}


/**
 * Conservative redaction for the log "message" field.
 * We do NOT apply LONG_OPAQUE_RE here so strings like "embedded.auth.start" stay readable.
 */
export function redactLogMessage(message: string): string {
  const scrubbed = scrubCommonSubstrings(message);

  // Redact only if message clearly contains a secret/token pattern
  if (BEARER_PREFIX_RE.test(scrubbed)) return `Bearer ${REDACTED}`;

  // ✅ FIX: don’t treat short dotted strings as JWTs in messages (keeps embedded.auth.start visible)
  if (isLikelyJwtTripleSegment(scrubbed) && scrubbed.length >= 30) return REDACTED;

  if (SHOPIFY_TOKEN_PREFIX_RE.test(scrubbed)) return REDACTED;

  return scrubbed;
}

/**
 * Strong scrubbing for errorMessage. Treat as untrusted and apply aggressive rules.
 */
export function sanitizeErrorMessage(message: string): string {
  return redactString(message);
}

function sanitizeValue(v: unknown): unknown {
  if (typeof v === "string") return redactString(v);
  return v;
}

function sanitizeMeta(input: unknown, depth = 0): unknown {
  if (depth > 6) return "[Truncated]";
  if (input == null) return input;

  if (typeof input === "string") return redactString(input);

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

      // 1) Allowlist: do NOT redact these keys by name
      if (ALLOW_KEYS.has(nk)) {
        out[k] = sanitizeMeta(v, depth + 1);
        continue;
      }

      // 2) Always scrub errorMessage strongly
      if (nk === "errormessage" && typeof v === "string") {
        out[k] = sanitizeErrorMessage(v);
        continue;
      }

      // 3) Bodies/payloads omitted entirely
      if (BODY_KEY_RE.test(nk)) {
        out[k] = OMITTED;
        continue;
      }

      // 4) Sensitive keys redacted
      if (SENSITIVE_KEY_RE.test(nk)) {
        out[k] = REDACTED;
        continue;
      }

      // 5) Recurse / sanitize values
      out[k] = sanitizeMeta(sanitizeValue(v), depth + 1);
    }

    return out;
  }

  return sanitizeValue(input);
}

/**
 * Redact/sanitize meta objects for logging.
 * - Redacts known sensitive keys
 * - Omits bodies/payloads
 * - Sanitizes token-like strings even under non-sensitive keys
 */
export function redactForLogs(meta: unknown): unknown {
  return sanitizeMeta(meta, 0);
}
